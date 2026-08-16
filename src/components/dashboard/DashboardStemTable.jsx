import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns3, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TableShell from '@/components/common/TableShell';

const DEFAULT_COLUMNS = ['stem', 'deliveryDate', 'vessel', 'buyer', 'supplier', 'productQuantity', 'port', 'turnover', 'grossProfit', 'dispute'];
const COLUMN_LABELS = {
  stem: 'STEM',
  deliveryDate: 'Delivery / expected date',
  vessel: 'Vessel',
  buyer: 'Buyer',
  supplier: 'Supplier',
  productQuantity: 'Product / extra cost · quantity',
  port: 'Port / country',
  turnover: 'Turnover',
  grossProfit: 'Gross profit',
  dispute: 'Dispute',
};
const MONEY_COLUMNS = new Set(['turnover', 'grossProfit']);
const SORT_FIELDS = { stem: 'name', deliveryDate: 'deliveryDate' };

const money = (value, currency = 'USD') => {
  if (!Number.isFinite(Number(value))) return '—';
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : null;
  if (!safeCurrency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value));
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: safeCurrency, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(Number(value));
};
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : '—';

function productQuantities(row) {
  if (Array.isArray(row.productQuantities)) return row.productQuantities;
  if (Array.isArray(row._Product_Quantity_List)) return row._Product_Quantity_List;
  return String(row._Product_Quantities || '').split(',').map((label) => label.trim()).filter(Boolean).map((label) => ({ productName: label, quantityLabel: '' }));
}

function supplierProductRows(row) {
  if (Array.isArray(row.supplierProductRows)) return row.supplierProductRows;
  const legacySupplier = row.supplierNames?.join(', ') ?? row.supplierName ?? row._Supplier_Names ?? row.supplier ?? null;
  const legacyProducts = productQuantities(row);
  if (!legacySupplier && !legacyProducts.length) return [];
  return [{
    sourceType: 'legacy',
    sourceId: null,
    supplierAccount: null,
    supplierLabel: legacySupplier,
    itemName: legacyProducts.map((item) => [item.productName, item.quantityLabel].filter(Boolean).join(' ')).join(', ') || 'Product unavailable',
    quantityLabel: null,
  }];
}

function valueFor(row, column) {
  const values = {
    stem: row.name ?? row.Name ?? row.stemName ?? row.KeyStem__c,
    deliveryDate: row.deliveryDate ?? row.Delivery_Date__c ?? row.Expected_Delivery_Date__c,
    vessel: row.vessel?.name ?? row.vessel ?? row.Vessel__c,
    buyer: row.account?.name ?? row.buyerName ?? row.Buyer_Name__c ?? row.buyer,
    supplier: row.supplierNames?.join(', ') ?? row.supplierName ?? row._Supplier_Names ?? row.supplier,
    productQuantity: productQuantities(row).map((item) => [item.productName, item.quantityLabel].filter(Boolean).join(' ')).join(', '),
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

function DeliveryValue({ row }) {
  const value = valueFor(row, 'deliveryDate');
  const source = row.deliveryDateSource || (row.Delivery_Date__c ? 'delivery' : row.Expected_Delivery_Date__c ? 'expected' : null);
  return <span className="flex flex-col whitespace-nowrap"><span>{date(value)}</span><span className={`text-[10px] font-medium ${source === 'expected' ? 'text-amber-700' : 'text-muted-foreground'}`}>{source === 'delivery' ? 'Actual delivery' : source === 'expected' ? 'Expected delivery' : 'Date unavailable'}</span></span>;
}

function ProductQuantityValue({ row }) {
  const items = productQuantities(row);
  if (!items.length) return '—';
  return <span className="flex min-w-64 flex-wrap gap-1">{items.map((item, index) => <span key={`${item.productName}:${item.quantityLabel}:${index}`} className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[11px]"><strong>{item.productName}</strong>{item.quantityLabel ? <span className="ml-1 text-muted-foreground">{item.quantityLabel}</span> : null}</span>)}</span>;
}

function SupplierProductSupplier({ item, onAccountClick }) {
  const account = item?.supplierAccount;
  const label = account?.name || item?.supplierLabel || 'Supplier unavailable';
  if (account?.id && onAccountClick) return <button type="button" className="max-w-full text-left text-primary hover:underline" onClick={(event) => { event.stopPropagation(); onAccountClick({ accountId: account.id, name: label, role: 'supplier' }); }}>{label}</button>;
  return <span className={account?.name || item?.supplierLabel ? '' : 'text-muted-foreground'}>{label}</span>;
}

function SupplierProductItem({ item }) {
  if (!item) return <span className="text-muted-foreground">Product unavailable</span>;
  return <span className="flex min-w-0 flex-wrap items-center gap-1.5">
    {item.sourceType === 'extra_cost' ? <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">Extra cost</span> : null}
    <strong>{item.itemName || (item.sourceType === 'extra_cost' ? 'Extra cost unavailable' : 'Product unavailable')}</strong>
    {item.quantityLabel ? <span className="text-muted-foreground">{item.quantityLabel}</span> : null}
  </span>;
}

function renderValue(row, column, onAccountClick) {
  const value = valueFor(row, column);
  if (column === 'deliveryDate') return <DeliveryValue row={row} />;
  if (column === 'productQuantity') return <ProductQuantityValue row={row} />;
  if (MONEY_COLUMNS.has(column)) return money(value, row.currency ?? row.CurrencyIsoCode);
  if (column === 'dispute') return <span className={String(value).toLowerCase().includes('dispute') ? 'rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800' : 'text-muted-foreground'}>{value || '—'}</span>;
  const account = accountFor(row, column);
  if (account?.accountId && onAccountClick) return <button type="button" className="max-w-full truncate text-left text-primary hover:underline" onClick={(event) => { event.stopPropagation(); onAccountClick({ ...account, role: account.role || (column === 'supplier' ? 'supplier' : 'buyer') }); }}>{value || account.name || '—'}</button>;
  return value == null || value === '' ? '—' : String(value);
}

function Pagination({ loading, hasPrevious, hasNext, page, onPrevious, onNext }) {
  return <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2"><Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={loading || !hasPrevious} onClick={onPrevious}><ChevronLeft className="h-3.5 w-3.5" />Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={loading || !hasNext} onClick={onNext}>Next<ChevronRight className="h-3.5 w-3.5" /></Button></div>;
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
  const meta = total ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()} · Server paginated` : 'No matching STEMs';
  const actions = <><form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); onSearch?.(searchDraft.trim()); }}><Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search STEMs" aria-label="Search STEMs" className="h-8 w-36 text-xs" /><Button type="submit" variant="outline" size="sm" className="h-8 px-2" disabled={loading}><Search className="h-3.5 w-3.5" /><span className="sr-only">Search</span></Button></form><Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 text-xs"><Columns3 className="mr-1 h-3.5 w-3.5" />Columns</Button></PopoverTrigger><PopoverContent align="end" className="w-56 p-2">{DEFAULT_COLUMNS.map((column) => <label key={column} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"><Checkbox checked={visibleColumns.includes(column)} onCheckedChange={() => toggleColumn(column)} />{COLUMN_LABELS[column]}</label>)}</PopoverContent></Popover></>;

  return <TableShell title="STEMs" meta={meta} bodyClassName="p-0" actions={actions}>
    <div className="divide-y divide-border md:hidden">{rows.map((row, index) => {
      const childRows = supplierProductRows(row);
      return <div role="button" tabIndex={0} key={row.id ?? row.Id ?? index} onClick={() => onStemClick?.(row)} onKeyDown={(event) => { if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) onStemClick?.(row); }} className="block w-full cursor-pointer px-4 py-3 text-left hover:bg-muted/30"><div className="flex items-start justify-between gap-3"><span className="font-semibold">{renderValue(row, 'stem', onAccountClick)}</span>{renderValue(row, 'deliveryDate', onAccountClick)}</div><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="truncate">{renderValue(row, 'buyer', onAccountClick)}</span><span className="text-right font-semibold text-foreground">{renderValue(row, 'grossProfit', onAccountClick)}</span><div className="col-span-2 mt-1 divide-y divide-border/60 rounded-md border border-border bg-background/60">{childRows.length ? childRows.map((item, childIndex) => <div key={`${item.sourceType}:${item.sourceId || childIndex}`} data-source-type={item.sourceType} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] gap-2 px-2 py-1.5"><SupplierProductSupplier item={item} onAccountClick={onAccountClick} /><SupplierProductItem item={item} /></div>) : <div className="px-2 py-1.5 text-muted-foreground">No product or extra-cost rows</div>}</div><span>{renderValue(row, 'port', onAccountClick)}</span></div></div>;
    })}{!rows.length && !loading ? <div className="px-4 py-14 text-center text-sm text-muted-foreground">No STEMs match these filters. Reset a filter or select a wider period.</div> : null}</div>
    <div className="relative hidden overflow-x-auto md:block">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="border-b border-border bg-muted/30"><tr>{displayColumns.map((column) => <th key={column} className={`whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${MONEY_COLUMNS.has(column) ? 'text-right' : ''}`}>{SORT_FIELDS[column] ? <button type="button" onClick={() => applySort(column)} className="hover:text-foreground">{COLUMN_LABELS[column]} {sort.field === SORT_FIELDS[column] ? (sort.direction === 'asc' ? '↑' : '↓') : ''}</button> : COLUMN_LABELS[column]}</th>)}</tr></thead>
        <tbody className={loading && rows.length ? 'opacity-55' : ''}>{rows.flatMap((row, index) => {
          const stemKey = row.id ?? row.Id ?? index;
          const showsChildColumns = displayColumns.includes('supplier') || displayColumns.includes('productQuantity');
          const children = showsChildColumns ? supplierProductRows(row) : [];
          const physicalRows = children.length ? children : [null];
          return physicalRows.map((item, childIndex) => <tr key={`${stemKey}:${item?.sourceType || 'stem'}:${item?.sourceId || childIndex}`} data-stem-group={stemKey} data-source-type={item?.sourceType || undefined} onClick={() => onStemClick?.(row)} className={`${childIndex === physicalRows.length - 1 ? 'border-b border-border/60' : 'border-b border-border/30'} hover:bg-muted/30 ${onStemClick ? 'cursor-pointer' : ''}`}>{displayColumns.map((column) => {
            if (column === 'supplier') return <td key={column} className="max-w-72 px-3 py-2.5 align-top"><SupplierProductSupplier item={item} onAccountClick={onAccountClick} /></td>;
            if (column === 'productQuantity') return <td key={column} className="max-w-96 px-3 py-2.5 align-top"><SupplierProductItem item={item} /></td>;
            if (childIndex > 0) return null;
            return <td key={column} rowSpan={physicalRows.length} className={`max-w-72 px-3 py-3 align-top ${MONEY_COLUMNS.has(column) ? 'text-right tabular-nums' : 'truncate'}`} title={typeof valueFor(row, column) === 'string' ? valueFor(row, column) : undefined}>{renderValue(row, column, onAccountClick)}</td>;
          })}</tr>);
        })}
          {!rows.length && !loading ? <tr><td colSpan={displayColumns.length} className="px-4 py-14 text-center text-sm text-muted-foreground">No STEMs match these filters. Reset a filter or select a wider period.</td></tr> : null}
        </tbody>
      </table>
      {loading && !rows.length ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading STEMs…</div> : null}
    </div>
    <Pagination loading={loading} hasPrevious={hasPrevious} hasNext={hasNext} page={page} onPrevious={onPrevious} onNext={onNext} />
  </TableShell>;
}
