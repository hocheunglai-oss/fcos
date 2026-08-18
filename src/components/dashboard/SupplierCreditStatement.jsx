import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Loader2, RefreshCw, Users } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';

const SCOPES = [
  { value: 'open', label: 'Open' },
  { value: 'open_recent', label: 'Open + 12 months settled' },
  { value: 'all', label: 'All history' },
];

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value, currency) {
  const parsed = numeric(value);
  return parsed == null ? 'Unavailable' : `${currency || 'USD'} ${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value) {
  if (!value) return 'Unknown';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function chartPoints(chart) {
  const rows = new Map();
  for (const [series, points] of [['account', chart.account?.points || []], ['group', chart.group?.points || []]]) {
    for (const point of points) rows.set(point.date, { ...(rows.get(point.date) || { date: point.date }), [series]: point.remaining });
  }
  let account = null;
  let group = null;
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date)).map((row) => {
    if (row.account != null) account = row.account;
    if (row.group != null) group = row.group;
    return { ...row, account: row.account ?? account, group: row.group ?? group };
  });
}

function KpiCard({ label, value, currency, warning = false, detail = null }) {
  return <div className={`rounded-lg border p-3 ${warning ? 'border-amber-200 bg-amber-50' : 'border-border bg-background'}`}><div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-lg font-bold tabular-nums">{money(value, currency)}</div>{detail ? <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div> : null}</div>;
}

function CurrencyPosition({ title, rows = [] }) {
  if (!rows.length) return <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No {title.toLowerCase()} payable exposure is available.</div>;
  return <div className="space-y-3"><h4 className="text-sm font-semibold">{title}</h4>{rows.map((row) => <div key={row.currency} className="rounded-xl border border-border p-3"><div className="mb-3 flex items-center justify-between"><span className="font-semibold">{row.currency}</span>{!row.complete ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Estimate incomplete</span> : null}</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><KpiCard label="Issued payable" value={row.issuedPayable} currency={row.currency} /><KpiCard label="Uninvoiced estimate" value={row.uninvoicedEstimate} currency={row.currency} warning={!row.complete} detail={!row.complete ? `${row.incompleteEstimateCount} estimate${row.incompleteEstimateCount === 1 ? '' : 's'} require evidence` : null} /><KpiCard label="Total exposure" value={row.totalExposure} currency={row.currency} warning={!row.complete} /><KpiCard label="Overdue" value={row.overdue} currency={row.currency} /><KpiCard label="Due within 7 days" value={row.dueWithin7Days} currency={row.currency} /><KpiCard label="Due within 30 days" value={row.dueWithin30Days} currency={row.currency} /><KpiCard label="Paid in previous 12 months" value={row.recentlyPaid} currency={row.currency} /></div></div>)}</div>;
}

function PayableChart({ chart, includeGroup }) {
  const data = useMemo(() => chartPoints(chart), [chart]);
  if (!chart.complete) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h4 className="font-semibold text-amber-950">{chart.currency} payable forecast unavailable</h4><p className="mt-1 text-xs text-amber-900">One or more uninvoiced supplier obligations lack complete price, quantity, UOM, or invoice-linkage evidence. FCOS does not publish a partial total or forecast.</p></div>;
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{chart.currency} remaining payable forecast</h4><p className="mt-1 text-xs text-muted-foreground">Square steps descend only on evidenced payment dates. Undated obligations remain in the final plateau.</p></div><div className="flex flex-wrap gap-3 text-xs"><span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-sky-600" />Account · {money(chart.account?.opening, chart.currency)}</span>{includeGroup ? <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-violet-600" />GROUP · {money(chart.group?.opening, chart.currency)}</span> : null}</div></div><div className="mt-4 h-72 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} minTickGap={28} /><YAxis tickFormatter={(value) => Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : Math.abs(value) >= 1_000 ? `${Math.round(value / 1_000)}k` : value} width={56} /><Tooltip labelFormatter={displayDate} formatter={(value, name) => [money(value, chart.currency), name === 'group' ? 'GROUP remaining' : 'Account remaining']} /><Line type="stepAfter" dataKey="account" name="account" stroke="#0284c7" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />{includeGroup ? <Line type="stepAfter" dataKey="group" name="group" stroke="#7c3aed" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /> : null}</LineChart></ResponsiveContainer></div>{chart.account?.undatedExposure > 0 || chart.group?.undatedExposure > 0 ? <div className="mt-2 text-xs text-amber-800">Undated residual: Account {money(chart.account?.undatedExposure, chart.currency)}{includeGroup ? ` · GROUP ${money(chart.group?.undatedExposure, chart.currency)}` : ''}</div> : null}</div>;
}

function evidenceSummary(row) {
  if (row.rowType === 'issued') return `${row.supplierInvoiceName} · Invoice ${money(row.invoiceAmount, row.currency)} · Payable ${money(row.payableBalance, row.currency)}${row.partialDueDate ? ` · Partial ${money(row.partialAmount, row.currency)} due ${displayDate(row.partialDueDate)}` : ''}`;
  return `Expected supplier cost ${money(row.expectedSupplierCost, row.currency)}${row.usesRangeMaximum ? ' (BASIS MAX QTY)' : ''}`;
}

function CopySelection({ rows, identityName, onCopied, onError }) {
  const copy = async () => {
    const groups = new Map();
    for (const row of rows) {
      const values = groups.get(row.currency) || [];
      values.push(row);
      groups.set(row.currency, values);
    }
    const plainLines = [];
    const htmlLines = [];
    for (const row of rows) {
      const supplier = row.supplierName || identityName;
      if (row.rowType === 'issued') {
        const plain = `${row.stemName || 'STEM'} - ${supplier} - SUPPLIER INVOICE ${row.supplierInvoiceName} - INVOICE AMOUNT ${money(row.invoiceAmount, row.currency)} - PAYABLE BALANCE ${money(row.payableBalance, row.currency)} - DUE DATE ${displayDate(row.dueDate)}`;
        plainLines.push(plain);
        htmlLines.push(escapeHtml(plain));
      } else {
        const plain = `${row.stemName || 'STEM'} - ${supplier} - EXPECTED SUPPLIER COST ${money(row.expectedSupplierCost, row.currency)}${row.usesRangeMaximum ? ' (BASIS MAX QTY)' : ''} - EXPECTED PAYMENT DATE ${displayDate(row.expectedPaymentDate)}`;
        plainLines.push(plain);
        htmlLines.push(escapeHtml(plain));
      }
    }
    plainLines.push('');
    htmlLines.push('');
    for (const [currency, groupRows] of groups) {
      const total = groupRows.reduce((sum, row) => sum + (numeric(row.currentExposure) || 0), 0);
      const expected = groupRows.some((row) => row.rowType === 'uninvoiced');
      const line = `TOTAL PAYABLE EXPOSURE - ${money(total, currency)}${expected ? ' (EXPECTED)' : ''}`;
      plainLines.push(line);
      htmlLines.push(`<strong>${escapeHtml(line)}</strong>`);
    }
    const plain = plainLines.join('\n');
    const html = htmlLines.join('<br>');
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plain);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = plain;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      onCopied();
    } catch {
      onError?.('Unable to copy the selected payable details.');
    }
  };
  return <Button type="button" size="sm" onClick={copy} disabled={!rows.length} className="gap-2"><Copy className="h-4 w-4" />Copy details</Button>;
}

function EvidenceDetails({ row }) {
  if (row.rowType !== 'uninvoiced' || !row.childEvidence?.length) return null;
  return <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-primary">{row.childEvidence.length} supplier child record{row.childEvidence.length === 1 ? '' : 's'}</summary><div className="mt-2 space-y-1">{row.childEvidence.map((child) => <div key={child.childId} className={child.complete ? 'text-muted-foreground' : 'text-amber-800'}>{child.label} · {child.complete ? `${money(child.amount, row.currency)} · ${child.basis?.replaceAll('_', ' ')}` : child.blockingReason}</div>)}</div></details>;
}

function StatementCard({ row, selected, onSelect, onStemClick }) {
  const selectable = row.exposureComplete && numeric(row.currentExposure) > 0.005;
  return <article className={`rounded-lg border p-4 ${row.rowType === 'uninvoiced' ? 'border-amber-200 bg-amber-50/40' : 'border-border bg-card'}`}><div className="flex items-start gap-3"><input type="checkbox" aria-label={`Select ${row.stemName || row.rowId}`} checked={selected} disabled={!selectable} onChange={() => onSelect(row)} /><div className="min-w-0 flex-1"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onStemClick(row.stemId)}>{row.stemName || 'STEM unavailable'}</button><div className="mt-1 text-xs text-muted-foreground">{row.supplierName || 'Supplier unavailable'} · {row.currency}</div><div className="mt-2 text-sm font-semibold">{evidenceSummary(row)}</div><div className="mt-1 text-xs">{row.rowType === 'issued' ? `Due ${displayDate(row.dueDate)}` : `Expected payment ${displayDate(row.expectedPaymentDate)}`}</div>{!row.exposureComplete ? <div className="mt-2 text-xs text-amber-800">Estimate unavailable: {row.warnings?.[0] || 'Required evidence is incomplete.'}</div> : null}<EvidenceDetails row={row} /></div></div></article>;
}

export default function SupplierCreditStatement({ accountId, active, filters = {}, onStemClick }) {
  const [scope, setScope] = useState('open');
  const [includeGroup, setIncludeGroup] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [] });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(null);
  const [expandedWarnings, setExpandedWarnings] = useState(false);
  const requestRef = useRef(null);
  const filterPayload = useMemo(() => ({
    accountIds: Array.isArray(filters?.accountIds) ? filters.accountIds : [],
    supplierIds: Array.isArray(filters?.supplierIds) ? filters.supplierIds : [],
    portIds: Array.isArray(filters?.portIds) ? filters.portIds : [],
    countryCodes: Array.isArray(filters?.countryCodes) ? filters.countryCodes : [],
  }), [filters?.accountIds, filters?.countryCodes, filters?.portIds, filters?.supplierIds]);

  const load = useCallback(async ({ cursor = null, history = [], force = false } = {}) => {
    if (!active || !accountId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await appClient.functions.invoke('dashboardAccountCreditStatement', {
        accountId, side: 'supplier', scope, includeGroup, cursor, limit: 50, filters: filterPayload, force,
      }, { cache: true, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'supplier-credit', `account:${accountId}`], signal: controller.signal, force });
      if (controller.signal.aborted) return;
      if (response.data?.error) throw new Error(response.data.error);
      setResult(response.data);
      const ids = new Set((response.data?.statement?.rows || []).map((row) => row.rowId));
      setSelectedIds((current) => new Set([...current].filter((id) => ids.has(id))));
      setNavigation({ cursor, history });
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'The live Supplier Credit Statement could not be loaded.');
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [accountId, active, filterPayload, includeGroup, scope]);

  useEffect(() => { if (active) load(); return () => requestRef.current?.abort(); }, [active, load]);
  useEffect(() => { setSelectedIds(new Set()); setCopied(false); }, [accountId, includeGroup, scope]);
  if (!active) return null;
  if (loading && !result) return <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading live Supplier Credit Statement…</div>;
  if (error && !result) return <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4" />{error}<Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => load()}>Retry</Button></div>;
  if (!result) return null;
  const rows = result.statement?.rows || [];
  const selectedRows = rows.filter((row) => selectedIds.has(row.rowId));
  const selectableRows = rows.filter((row) => row.exposureComplete && numeric(row.currentExposure) > 0.005);
  const toggleRow = (row) => { setCopied(false); setCopyError(null); setSelectedIds((current) => { const next = new Set(current); if (next.has(row.rowId)) next.delete(row.rowId); else next.add(row.rowId); return next; }); };
  const toggleAll = () => setSelectedIds(selectedRows.length === selectableRows.length && selectableRows.length ? new Set() : new Set(selectableRows.map((row) => row.rowId)));

  return <div className="space-y-5" data-testid="supplier-credit-statement">
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-semibold">Supplier Credit Statement</h2><p className="mt-1 text-xs text-muted-foreground">{result.identity.name} · exact supplier Account{result.group ? ` · Ultimate GROUP ${result.group.name}` : ''}</p></div><div className="flex flex-wrap gap-2">{SCOPES.map((item) => <Button key={item.value} type="button" size="sm" variant={scope === item.value ? 'default' : 'outline'} onClick={() => { setResult(null); setNavigation({ cursor: null, history: [] }); setScope(item.value); }}>{item.label}</Button>)}<Button type="button" size="sm" variant={includeGroup ? 'secondary' : 'outline'} aria-pressed={includeGroup} onClick={() => { setResult(null); setNavigation({ cursor: null, history: [] }); setIncludeGroup((value) => !value); }} disabled={!result.group}><Users className="mr-1.5 h-4 w-4" />Include GROUP</Button><Button type="button" size="icon" variant="ghost" aria-label="Refresh Supplier Credit Statement" onClick={() => load({ cursor: navigation.cursor, history: navigation.history, force: true })} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div></div>
    {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4" />{error}</div> : null}
    {result.warnings?.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><button type="button" className="flex w-full items-center justify-between gap-3 text-left font-semibold" onClick={() => setExpandedWarnings((value) => !value)}><span>Supplier statement safeguards · {result.warnings.length}</span>{expandedWarnings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>{expandedWarnings ? <ul className="mt-2 space-y-1 text-xs">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : null}</div> : null}
    <section className={`grid gap-4 ${includeGroup && result.group ? 'xl:grid-cols-2' : ''}`}><CurrencyPosition title="Selected Account" rows={result.kpis?.account} />{includeGroup && result.group ? <CurrencyPosition title="GROUP" rows={result.kpis?.group} /> : null}</section>
    <section className="space-y-4">{result.chart?.currencies?.map((chart) => <PayableChart key={chart.currency} chart={chart} includeGroup={includeGroup} />)}{!result.chart?.currencies?.length ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No payable forecast exists for this scope.</div> : null}</section>
    <section className="rounded-xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="font-semibold">Statement evidence</h3><p className="mt-1 text-xs text-muted-foreground">Issued rows use live Supplier Invoice payable balances. Uninvoiced rows use exact, unlinked supplier children and are clearly marked as estimates.</p></div><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{selectedRows.length ? `${selectedRows.length} selected` : `${selectableRows.length} payable rows available`}</span><Button type="button" size="sm" variant="outline" onClick={toggleAll} disabled={!selectableRows.length}>{selectedRows.length === selectableRows.length && selectableRows.length ? 'Clear selection' : 'Select all'}</Button><CopySelection rows={selectedRows} identityName={result.identity.name} onCopied={() => { setCopied(true); setCopyError(null); }} onError={setCopyError} />{copied ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check className="h-4 w-4" />Copied</span> : null}</div></div>
      {copyError ? <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{copyError}</div> : null}
      <div className="space-y-3 p-4 md:hidden">{rows.map((row) => <StatementCard key={row.rowId} row={row} selected={selectedIds.has(row.rowId)} onSelect={toggleRow} onStemClick={onStemClick} />)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2"><input type="checkbox" aria-label="Select all supplier statement rows" checked={selectableRows.length > 0 && selectedRows.length === selectableRows.length} onChange={toggleAll} /></th><th className="px-3 py-2">STEM / supplier</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2 text-right">Invoice amount</th><th className="px-3 py-2 text-right">Current payable exposure</th><th className="px-3 py-2">Due / expected payment</th><th className="px-3 py-2">Forecast evidence</th></tr></thead><tbody>{rows.map((row) => { const selectable = row.exposureComplete && numeric(row.currentExposure) > 0.005; return <tr key={row.rowId} className={`border-t border-border align-top ${row.rowType === 'uninvoiced' ? 'bg-amber-50/60' : ''}`}><td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${row.stemName || row.rowId}`} checked={selectedIds.has(row.rowId)} disabled={!selectable} onChange={() => toggleRow(row)} /></td><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onStemClick(row.stemId)}>{row.stemName || 'STEM unavailable'}</button><div className="text-xs text-muted-foreground">{row.supplierName || 'Supplier unavailable'} · {row.currency}</div></td><td className="px-3 py-3"><div className="font-medium">{row.rowType === 'issued' ? row.supplierInvoiceName : 'Uninvoiced estimate'}</div><EvidenceDetails row={row} />{!row.exposureComplete ? <div className="mt-1 max-w-72 text-xs text-amber-800">{row.warnings?.[0] || 'Estimate evidence is incomplete.'}</div> : null}</td><td className="px-3 py-3 text-right tabular-nums">{row.rowType === 'issued' ? money(row.invoiceAmount, row.currency) : <>{money(row.expectedSupplierCost, row.currency)}{row.usesRangeMaximum ? <div className="text-[10px] font-semibold text-amber-800">BASIS MAX QTY</div> : null}</>}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.currentExposure, row.currency)}</td><td className="px-3 py-3"><div className={row.overdue ? 'font-semibold text-red-700' : ''}>{displayDate(row.dueDate || row.expectedPaymentDate)}</div><div className="text-xs text-muted-foreground">{row.rowType === 'issued' ? row.overdue ? 'Overdue' : 'Supplier Invoice due' : 'Expected payment date'}</div></td><td className="space-y-1 px-3 py-3 text-xs">{row.forecastEvents?.map((event, index) => <div key={`${event.childId || event.cashflowId || row.rowId}:${event.date}:${index}`}><span className="font-medium">{displayDate(event.date)} · {event.sourceLabel}</span> · {money(event.amount, row.currency)}</div>)}{numeric(row.undatedAmount) > 0 ? <div className="font-medium text-amber-800">Unknown date residual · {money(row.undatedAmount, row.currency)}</div> : null}{!row.forecastEvents?.length && !(numeric(row.undatedAmount) > 0) ? <span className="text-muted-foreground">No open forecast event.</span> : null}</td></tr>; })}{!rows.length ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No supplier payable rows match this scope.</td></tr> : null}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-border p-4"><span className="text-xs text-muted-foreground">Page {navigation.history.length + 1} · {result.statement.total} matching rows</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!navigation.history.length || loading} onClick={() => load({ cursor: navigation.history.at(-1) || null, history: navigation.history.slice(0, -1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={!result.statement.nextCursor || loading} onClick={() => load({ cursor: result.statement.nextCursor, history: [...navigation.history, navigation.cursor] })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
    </section>
  </div>;
}
