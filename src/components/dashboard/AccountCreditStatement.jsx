import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appClient } from '@/api/appClient';
import CalculationEvidence from '@/components/common/CalculationEvidence';
import CreditForecastConservativenessControl from '@/components/dashboard/CreditForecastConservativenessControl';
import CreditStatementSideToggle from '@/components/dashboard/CreditStatementSideToggle';
import GroupAccountScopeSelector from '@/components/dashboard/GroupAccountScopeSelector';
import { Button } from '@/components/ui/button';
import { accountStatementInvoiceCopyPayload } from '@/lib/paymentReminderClipboard';
import PaymentDataReliabilityBadge from '@/components/common/PaymentDataReliabilityBadge';

const SCOPES = [
  { value: 'open', label: 'Open only' },
  { value: 'open_recent', label: 'Open + 12 months settled' },
  { value: 'all', label: 'All history' },
];

const CREDIT_LIMIT_COLORS = {
  individual_limit: '#0369a1',
  group_limit: '#7c3aed',
  special_account_cap: '#0d9488',
  special_group_capacity: '#a855f7',
};

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value, currency) {
  const amount = numeric(value);
  if (amount == null) return 'Unavailable';
  return `${currency || 'USD'} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function reminderCopyMoney(value, currency) {
  const amount = numeric(value);
  if (amount == null) return '-';
  const formatted = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (currency || 'USD') === 'USD' ? `$${formatted}` : `${currency} ${formatted}`;
}

function displayDate(value) {
  if (!value) return 'Release date unknown';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function reminderCopyStatus(daysUntilDue) {
  const days = numeric(daysUntilDue);
  if (days == null) return '-';
  if (days <= 0) return `Overdue ${Math.abs(days).toLocaleString()} Days`;
  return 'Due Soon';
}

function expectedInvoiceBasisSuffix(row, { uppercase = false } = {}) {
  if (row?.expectedBuyerInvoiceAmountBasis !== 'range_max_quantity') return '';
  return uppercase ? ' (BASIS MAX QTY)' : ' (basis max qty)';
}

function statementExposureBasisSuffix(row) {
  if (row?.statementExposureBasis === 'salesforce_qlik_midpoint') return ' (Salesforce Mid Qty)';
  if (row?.statementExposureBasis === 'issued_receivable') return ' (Issued)';
  return '';
}

function rangeSummary(row, currency) {
  const range = row?.exposureRange;
  if (!range?.complete) return range?.blockingReason || 'Range unavailable';
  if (!range.hasRange) return range.basis === 'delivered_bdn' ? `Actual delivered basis · ${money(range.midpointExposure, currency)}` : 'No open quantity range';
  return `${money(range.minimumExposure, currency)}–${money(range.maximumExposure, currency)} · Salesforce midpoint ${money(range.midpointExposure, currency)}`;
}

function statementRowSelectable(row) {
  return row?.hasBuyerInvoice
    ? row.buyerInvoiceAmountComplete === true
    : row?.expectedBuyerInvoiceAmountComplete === true;
}

function CreditKpi({ label, value, displayValue = null, currency, detail, warning = false, formula, sources = [], exclusions = [], asOf, classification = 'calculated' }) {
  const renderedValue = displayValue ?? money(value, currency);
  const unavailable = renderedValue === 'Unavailable' || renderedValue === '—';
  return <div className={`rounded-lg border p-3 ${warning ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}><div className="flex items-center justify-between gap-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><CalculationEvidence title={label} value={renderedValue} classification={unavailable ? 'incomplete' : classification} complete={!unavailable} formula={formula || detail || 'Use the applicable Salesforce credit-category field or reconciled FCOS exposure calculation.'} sources={sources.length ? sources : ['Exact Salesforce Account credit snapshot and exact Account-ID STEM exposure evidence.']} exclusions={exclusions} warnings={unavailable ? ['The displayed calculation is withheld because the applicable exposure did not reconcile.'] : warning ? ['Review the recorded difference from the authoritative Salesforce value.'] : []} asOf={asOf} /></div><div className="mt-1 text-lg font-semibold tabular-nums">{renderedValue}</div>{detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}</div>;
}

function ReconciliationBadge({ label, result }) {
  if (result?.notApplicable) return <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{label}: no GROUP projection</span>;
  if (result?.scoped) return <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">{label}: selected Accounts</span>;
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${result?.matches ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{label}: {result?.matches ? 'Reconciled' : 'Projection hidden'}</span>;
}

function CreditPositionPanel({ title, reconciliation, cards = [], currency, emptyMessage = null, asOf }) {
  return <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><ReconciliationBadge label={title} result={reconciliation} /></div>{emptyMessage ? <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div> : <div className="mt-4 grid grid-cols-2 gap-3">{cards.map((card) => <CreditKpi key={card.label} {...card} currency={currency} asOf={asOf} />)}</div>}</section>;
}

function accountPositionCards(credit, reconciliation) {
  if (credit.policy?.code === 'group_shared_uncapped') {
    return [
      { label: 'Used by Account', value: credit.usedCustomer },
      { label: 'Credit access', displayValue: 'No individual cap', detail: 'Uses remaining GROUP capacity.' },
    ];
  }
  if (credit.category === 'Special') {
    return [
      { label: 'Special Account cap', value: credit.specialIndividualLimit },
      { label: 'Used by Account', value: credit.usedCustomer },
      { label: 'Remaining special capacity', value: reconciliation?.matches ? credit.individualBalance : null, warning: !reconciliation?.matches },
      { label: 'Credit access', displayValue: credit.specialIndividualLimit === 0 ? 'No available credit' : 'GROUP with cap', detail: 'Both Account and GROUP constraints apply.' },
    ];
  }
  return [
    { label: 'Individual limit', value: credit.individualLimit },
    { label: 'Used by Account', value: credit.usedCustomer },
    { label: 'Individual balance', value: reconciliation?.matches ? credit.individualBalance : null, warning: !reconciliation?.matches },
    { label: 'Credit access', displayValue: credit.category === 'Individual' ? 'Individual only' : 'Unavailable', detail: credit.category === 'Individual' ? 'GROUP capacity is not available.' : 'Salesforce category is not supported.' },
  ];
}

function groupPositionCards(credit, reconciliation) {
  const cards = [{ label: 'GROUP limit', value: credit.groupLimit }];
  if (credit.category === 'Special') cards.push({ label: 'Special GROUP uplift', value: credit.specialGroupLimit });
  if (reconciliation?.scoped) {
    cards.push(
      { label: 'Selected Accounts exposure', value: reconciliation.reconstructed },
      { label: 'Full GROUP used (Salesforce)', value: credit.usedGroup, detail: 'This authoritative snapshot includes Accounts outside the current selection.' },
    );
    return cards;
  }
  cards.push(
    { label: 'Used by GROUP', value: credit.usedGroup },
    { label: 'GROUP balance', value: reconciliation?.matches ? credit.groupBalance : null, warning: !reconciliation?.matches },
  );
  return cards;
}

function ReleaseTooltip({ active, payload, label, currency, showRange = false, rangeScope = 'account' }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const prefix = rangeScope === 'group' ? 'group' : 'individual';
  const midpoint = point[`${prefix}Exposure`];
  const minimum = point[`${prefix}ExposureMinimum`];
  const maximum = point[`${prefix}ExposureMaximum`];
  return <div className="max-w-sm rounded-md border border-border bg-background p-3 text-xs shadow-lg"><div className="font-semibold">{point.residualPlateau ? 'Undated residual plateau' : `Forecast point ${displayDate(label)}`}</div>{showRange && minimum != null && maximum != null ? <div className="mt-2 rounded bg-sky-50 p-2 text-sky-950"><div className="font-semibold">{rangeScope === 'group' ? 'GROUP' : 'Selected Account'} quantity range</div><div className="mt-1 grid grid-cols-3 gap-3 tabular-nums"><span>Min<br />{money(minimum, currency)}</span><span>Salesforce mid<br />{money(midpoint, currency)}</span><span>Max<br />{money(maximum, currency)}</span></div></div> : null}{point.events?.length ? <div className="mt-2 space-y-2">{point.events.map((event) => <div key={`${event.stemId}:${event.date}:${event.source}`}><div className="font-medium">{event.stemName} · {money(event.amount, currency)}</div><div className="text-muted-foreground">Exact date {displayDate(event.date)} · {event.sourceLabel}{event.accountName ? ` · ${event.accountName}` : ''}</div>{event.contractualDate ? <div className="mt-0.5 text-muted-foreground">Contractual date {displayDate(event.contractualDate)} · {event.percentileLabel || 'Trend'} {numeric(event.predictedDelayDays) >= 0 ? '+' : ''}{numeric(event.predictedDelayDays) ?? 0} days · {event.modelLevel || 'Default'} model · {event.modelSampleCount || 0} samples</div> : null}</div>)}</div> : <div className="mt-1 text-muted-foreground">{point.residualPlateau ? 'Exposure without a reliable release date remains outstanding.' : 'Opening exposure before forecast releases.'}</div>}</div>;
}

export function visibleCreditLimitReferences(data, series) {
  return (data?.credit?.referenceLimits || []).filter((limit) => {
    if (!(numeric(limit.value) > 0)) return false;
    if (limit.scope === 'account') return Boolean(series.account && data.reconciliation?.individual?.matches);
    if (limit.scope === 'group') return Boolean(data.group && series.group && data.reconciliation?.group?.matches);
    return false;
  });
}

function ReleaseChart({ data, series, showRange = false, rangeScope = 'account' }) {
  const chart = data.chart;
  const credit = data.credit;
  if (!data.complete || !chart?.points?.length || (!data.reconciliation?.individual?.matches && !data.reconciliation?.group?.matches)) {
    return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">A complete, reconciled future release projection is not available. Exact STEM evidence remains in the statement below.</div>;
  }
  const referenceLimits = visibleCreditLimitReferences(data, series);
  const rangeKey = rangeScope === 'group' ? 'groupExposureRange' : 'individualExposureRange';
  const chartPoints = chart.points.map((point) => ({
    ...point,
    individualExposureRange: point.individualExposureMinimum == null || point.individualExposureMaximum == null ? null : [Math.min(point.individualExposureMinimum, point.individualExposureMaximum), Math.max(point.individualExposureMinimum, point.individualExposureMaximum)],
    groupExposureRange: point.groupExposureMinimum == null || point.groupExposureMaximum == null ? null : [Math.min(point.groupExposureMinimum, point.groupExposureMaximum), Math.max(point.groupExposureMinimum, point.groupExposureMaximum)],
  }));
  const canShowRange = showRange && chart.range?.complete && chart.range?.hasRange && (rangeScope === 'group'
    ? data.group && series.group && data.reconciliation.group.matches
    : series.account && data.reconciliation.individual.matches);
  return <div className="w-full">{referenceLimits.length ? <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Applicable credit limits">{referenceLimits.map((limit) => <span key={limit.key} className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: CREDIT_LIMIT_COLORS[limit.key] || '#64748b' }} aria-hidden="true" />{limit.label}: <span className="font-semibold text-foreground">{money(limit.value, credit.currency)}</span></span>)}</div> : null}<div className="mb-1 text-[11px] font-medium text-muted-foreground">Solid lines use Salesforce QLIK mid-range exposure. The optional band shows FCOS minimum-to-maximum risk for un-invoiced range STEMs.</div><div className="h-[340px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartPoints} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(value) => String(value).slice(5)} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} /><Tooltip content={<ReleaseTooltip currency={credit.currency} showRange={canShowRange} rangeScope={rangeScope} />} /><Legend wrapperStyle={{ fontSize: 11 }} />{canShowRange ? <Area type="stepAfter" dataKey={rangeKey} name={`${rangeScope === 'group' ? 'GROUP' : 'Account'} possible quantity range`} stroke="none" fill={rangeScope === 'group' ? '#c4b5fd' : '#7dd3fc'} fillOpacity={0.35} connectNulls={false} /> : null}{series.account && data.reconciliation.individual.matches ? <Line type="stepAfter" dataKey="individualExposure" name="Account Salesforce midpoint exposure" stroke="#0369a1" strokeWidth={3} dot={{ r: 2.5 }} connectNulls={false} /> : null}{data.group && series.group && data.reconciliation.group.matches ? <Line type="stepAfter" dataKey="groupExposure" name="GROUP buyer Salesforce midpoint exposure" stroke="#7c3aed" strokeWidth={3} dot={{ r: 2.5 }} connectNulls={false} /> : null}{referenceLimits.map((limit) => <ReferenceLine key={limit.key} y={limit.value} stroke={CREDIT_LIMIT_COLORS[limit.key] || '#64748b'} strokeDasharray="4 4" ifOverflow="extendDomain" />)}</ComposedChart></ResponsiveContainer></div></div>;
}

function StatementCard({ row, currency, onStemClick, selected, onSelect }) {
  const rowCurrency = row.currency || currency;
  const selectable = statementRowSelectable(row);
  return <article className={`rounded-lg border p-4 ${row.hasBuyerInvoice ? 'border-border bg-card' : 'border-red-200 bg-red-50/70'}`}><div className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Select ${row.stemName} statement evidence`} checked={selected} disabled={!selectable} title={!selectable ? row.expectedBuyerInvoiceAmountBlockingReason || 'Invoice amount unavailable' : undefined} onChange={() => onSelect(row)} /><div className="min-w-0"><button type="button" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStemClick(row.stemId)}>{row.stemName}</button><div className="mt-1 text-xs text-muted-foreground">{row.accountName || 'Selected Account'} · {displayDate(row.effectiveDate)}</div>{row.hasBuyerInvoice ? <div className="mt-1 text-xs font-medium">Buyer invoice: {row.buyerInvoiceAmountComplete ? money(row.buyerInvoiceAmount, rowCurrency) : 'Amount unavailable'}</div> : <div className="mt-1 text-xs font-semibold text-red-800">Buyer invoice: Not Issued · Conservative expected invoice {row.expectedBuyerInvoiceAmountComplete ? <>{money(row.expectedBuyerInvoiceAmount, rowCurrency)}{expectedInvoiceBasisSuffix(row)}</> : 'amount unavailable'}</div>}</div></div>{row.inCreditProjection === false ? <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">Outside current credit lineage window</div> : null}<dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Current credit exposure</dt><dd className="font-semibold" title={row.statementExposureComplete ? undefined : row.statementExposureBlockingReason || 'Exposure unavailable'}>{row.statementExposureComplete ? <>{money(row.statementExposureAmount, rowCurrency)}{statementExposureBasisSuffix(row)}</> : <><span>Unavailable</span><span className="mt-1 block text-[11px] font-normal text-amber-700">{row.statementExposureBlockingReason || 'Exposure evidence is incomplete.'}</span></>}</dd></div><div><dt className="text-xs text-muted-foreground">Actual released</dt><dd className="font-semibold">{money(row.actualReleased, rowCurrency)}</dd></div><div className="col-span-2"><dt className="text-xs text-muted-foreground">Quantity exposure range</dt><dd className={`mt-1 ${row.exposureRange?.complete ? 'font-medium' : 'text-amber-700'}`}>{rangeSummary(row, rowCurrency)}</dd></div><div className="col-span-2"><dt className="text-xs text-muted-foreground">Release evidence</dt><dd className="mt-1 space-y-1">{row.actualReleases?.map((release) => <div key={`actual:${release.paymentId}`}><span className="font-medium">{displayDate(release.date)} · Actual payment</span> · {money(release.amount, rowCurrency)}</div>)}{row.forecastEvents?.map((release, index) => <div key={`forecast:${release.paymentId || release.cashflowId || index}`}><span className="font-medium">{displayDate(release.date)} · {release.sourceLabel}</span> · {money(release.amount, rowCurrency)}</div>)}{!row.actualReleases?.length && !row.forecastEvents?.length ? <div className="text-muted-foreground">No payment or reliable forecast evidence.</div> : null}</dd></div></dl></article>;
}

export default function AccountCreditStatement({ accountId, entityType = 'account', includedGroupAccountIds = null, onGroupScopeChange, active, statementSide = 'buyer', availableStatementSides = ['buyer'], onStatementSideChange, onStemClick }) {
  const [scope, setScope] = useState('open');
  const [result, setResult] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [] });
  const [series, setSeries] = useState({ account: true, group: true });
  const [showRange, setShowRange] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [forecastConservativeness, setForecastConservativeness] = useState(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(() => new Set());
  const [copyState, setCopyState] = useState('idle');
  const [copyError, setCopyError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(null);

  const load = useCallback(async ({ cursor = null, history = [], force = false } = {}) => {
    if (!active || !accountId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await appClient.functions.invoke('dashboardAccountCreditStatement', {
        accountId, entityId: accountId, entityType, includedAccountIds: includedGroupAccountIds, scope, cursor, limit: 50, force, forecastConservativeness,
      }, { cache: true, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'account-credit', `account:${accountId}`], signal: controller.signal, force });
      if (controller.signal.aborted) return;
      if (response.data?.error) throw new Error(response.data.error);
      setResult(response.data);
      const liveRows = response.data?.statement?.rows || [];
      setSelectedInvoiceIds((selected) => new Set([...selected].filter((stemId) => liveRows.some((row) => row.stemId === stemId && statementRowSelectable(row)))));
      setNavigation({ cursor, history });
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'The live credit statement could not be loaded.');
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [accountId, active, entityType, forecastConservativeness, includedGroupAccountIds, scope]);

  useEffect(() => { if (active) load(); return () => requestRef.current?.abort(); }, [active, load]);
  useEffect(() => {
    setForecastConservativeness(null);
    setShowRange(false);
    setSelectedInvoiceIds(new Set());
    setCopyState('idle');
    setCopyError(null);
  }, [accountId]);
  const rows = result?.statement?.rows || [];
  const currency = result?.credit?.currency;
  const nextCursor = result?.statement?.nextCursor;
  const calculatedAvailable = result?.credit?.calculatedAvailable;
  const chartSeries = entityType === 'group' ? { account: false, group: series.group } : series;
  const rangeScope = entityType !== 'group' && chartSeries.account && result?.reconciliation?.individual?.matches ? 'account' : 'group';
  const quantityRangeAvailable = result?.chart?.range?.complete && result.chart.range.hasRange && (rangeScope === 'account'
    ? chartSeries.account && result?.reconciliation?.individual?.matches
    : result?.group && chartSeries.group && result?.reconciliation?.group?.matches);
  const projectionWarnings = result?.projectionWarnings || result?.warnings || [];
  const selectableInvoiceRows = rows.filter(statementRowSelectable);
  const selectedInvoiceRows = selectableInvoiceRows.filter((row) => selectedInvoiceIds.has(row.stemId));
  const selectedNotIssuedCount = selectedInvoiceRows.filter((row) => !row.hasBuyerInvoice).length;
  const selectedInvoiceTotals = selectedInvoiceRows.reduce((totals, row) => {
    const rowCurrency = row.currency || currency || 'USD';
    const amount = row.hasBuyerInvoice ? numeric(row.buyerInvoiceAmount) : numeric(row.expectedBuyerInvoiceAmount);
    if (amount == null) return totals;
    const current = totals[rowCurrency] || { amount: 0, hasExpected: false };
    totals[rowCurrency] = {
      amount: current.amount + amount,
      hasExpected: current.hasExpected || !row.hasBuyerInvoice,
    };
    return totals;
  }, {});

  const toggleInvoice = (row) => {
    setCopyState('idle');
    setCopyError(null);
    setSelectedInvoiceIds((selected) => {
      const next = new Set(selected);
      if (next.has(row.stemId)) next.delete(row.stemId);
      else next.add(row.stemId);
      return next;
    });
  };

  const toggleAllInvoices = () => {
    setCopyState('idle');
    setCopyError(null);
    setSelectedInvoiceIds(selectedInvoiceRows.length === selectableInvoiceRows.length && selectableInvoiceRows.length
      ? new Set()
      : new Set(selectableInvoiceRows.map((row) => row.stemId)));
  };

  const copySelectedInvoices = async () => {
    const totalLines = Object.entries(selectedInvoiceTotals).map(([totalCurrency, total]) => `Total invoice amount - ${reminderCopyMoney(total.amount, totalCurrency)}${total.hasExpected ? ' (Expected)' : ''}`);
    const copyPayload = accountStatementInvoiceCopyPayload(selectedInvoiceRows.map((row) => ({
      stemName: row.stemName,
      buyerName: row.accountName || result.identity.name,
      invoiceIssued: row.hasBuyerInvoice,
      amount: row.hasBuyerInvoice
        ? reminderCopyMoney(row.buyerInvoiceAmount, row.currency || currency)
        : reminderCopyMoney(row.expectedBuyerInvoiceAmount, row.currency || currency),
      amountLabel: row.hasBuyerInvoice ? null : 'Expected Invoice Amount',
      amountSuffix: row.hasBuyerInvoice ? null : expectedInvoiceBasisSuffix(row, { uppercase: true }),
      dueDate: row.hasBuyerInvoice ? displayDate(row.buyerInvoiceDueDate) : displayDate(row.expectedBuyerInvoiceDueDate),
      dueDateLabel: row.hasBuyerInvoice ? 'Due Date' : 'Expected Due Date',
      status: row.hasBuyerInvoice ? reminderCopyStatus(row.buyerInvoiceDaysUntilDue) : null,
    })), totalLines);
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([copyPayload.html], { type: 'text/html' }),
            'text/plain': new Blob([copyPayload.text], { type: 'text/plain' }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copyPayload.text);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = copyPayload.text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyState('copied');
      setCopyError(null);
    } catch {
      setCopyState('idle');
      setCopyError('Unable to copy the selected invoice details.');
    }
  };

  if (!active) return null;
  if (loading && !result) return <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading live buyer-leg credit statement…</div>;
  if (error && !result) return <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}<Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => load()}>Retry</Button></div>;
  if (!result) return null;
  const creditPolicy = result.credit.policy || { label: result.credit.category || 'Unavailable', explanation: 'Salesforce credit policy is unavailable.' };
  const availableComparison = result.credit.availableComparison || {};
  const availableDifferenceDirection = numeric(availableComparison.difference) > 0 ? 'higher than' : 'lower than';
  const availableDifferenceDetail = availableComparison.materiallyDifferent
    ? `${availableComparison.formula}. Calculated availability is ${money(Math.abs(availableComparison.difference), currency)} ${availableDifferenceDirection} Salesforce.`
    : null;
  const evidenceAsOf = result.generatedAt || result.fetchedAt || result.creditResolution?.resolvedAt || null;

  return <div className="space-y-5" data-testid="account-credit-statement">
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Buyer-leg Credit Statement</h2><PaymentDataReliabilityBadge excludedCount={result.paymentDataReliability?.excludedLegacyRecordCount} /></div><p className="mt-1 text-xs text-muted-foreground">{result.identity.name}{result.group ? ` · Ultimate GROUP ${result.group.name} · ${result.group.memberCount} hierarchy Accounts` : ' · No Salesforce GROUP ancestor'} · {currency}</p></div><div className="flex flex-wrap gap-2">{SCOPES.map((item) => <Button key={item.value} type="button" size="sm" variant={scope === item.value ? 'default' : 'outline'} onClick={() => { setResult(null); setNavigation({ cursor: null, history: [] }); setSelectedInvoiceIds(new Set()); setCopyState('idle'); setScope(item.value); }}>{item.label}</Button>)}<Button type="button" size="sm" variant="outline" aria-expanded={showAssumptions} onClick={() => setShowAssumptions((visible) => !visible)}>{showAssumptions ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}{showAssumptions ? 'Hide assumptions' : 'Show assumptions'}</Button><Button type="button" size="icon" variant="ghost" aria-label="Refresh Credit Statement" onClick={() => load({ cursor: navigation.cursor, history: navigation.history, force: true })} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div></div>
    <GroupAccountScopeSelector groupScope={result.groupScope} selectedAccountIds={includedGroupAccountIds} onChange={(ids) => { setNavigation({ cursor: null, history: [] }); setSelectedInvoiceIds(new Set()); onGroupScopeChange?.(ids); }} disabled={loading} />
    {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
    {showAssumptions ? <div className="space-y-3">{result.creditResolution?.mode === 'same_name_fallback' ? <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"><div className="font-semibold">Salesforce credit snapshot resolved</div><p className="mt-1 text-xs">{result.creditResolution.notice}</p><p className="mt-1 text-xs font-medium">Fallback CL Key: {result.creditResolution.clKey || 'Unavailable'} · Reconciliation window: {displayDate(result.creditResolution.reconciliationWindowStart)}</p></div> : null}{projectionWarnings.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle className="h-4 w-4" />Projection safeguards</div><ul className="mt-2 space-y-1 text-xs text-amber-900">{projectionWarnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : null}</div> : null}
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">Credit position</h3><p className="mt-1 max-w-3xl text-xs text-muted-foreground">{creditPolicy.explanation}</p>{result.creditResolution?.mode === 'group_hierarchy_authority' ? <p className="mt-1 text-xs font-medium text-sky-800">Credit authority: {result.creditResolution.accountName}{result.creditResolution.clKey ? ` · ${result.creditResolution.clKey}` : ''}</p> : null}</div><span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">{creditPolicy.label}</span></div>
      {result.creditResolution?.reconciliation?.complete && !result.creditResolution.reconciliation.matches ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><div className="font-semibold">Salesforce GROUP snapshot differs from live buyer exposure</div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums"><span>Salesforce used: {money(result.creditResolution.reconciliation.expected, currency)}</span><span>Live buyer QLIK: {money(result.creditResolution.reconciliation.reconstructed, currency)}</span><span>Difference: {money(result.creditResolution.reconciliation.difference, currency)}</span></div></div> : null}
      <div className={`grid gap-3 ${entityType === 'group' ? '' : 'xl:grid-cols-2'}`}>
        {entityType !== 'group' ? <CreditPositionPanel title="Selected Account" reconciliation={result.reconciliation.individual} currency={currency} cards={accountPositionCards(result.credit, result.reconciliation.individual)} asOf={evidenceAsOf} /> : null}
        {result.group ? <CreditPositionPanel title={entityType === 'group' ? 'Selected GROUP Accounts' : 'GROUP'} reconciliation={result.reconciliation.group} currency={currency} cards={groupPositionCards(result.credit, result.reconciliation.group)} asOf={evidenceAsOf} /> : <CreditPositionPanel title="GROUP" reconciliation={{ notApplicable: true }} currency={currency} emptyMessage="No Salesforce GROUP ancestor applies to this Account." asOf={evidenceAsOf} />}
      </div>
      <div className={`grid gap-3 ${availableComparison.materiallyDifferent ? 'sm:grid-cols-2' : ''}`}>
        <CreditKpi label="Salesforce effective available" value={result.credit.salesforceAvailable} currency={currency} detail="Authoritative Salesforce effective available credit." classification="actual" formula="Use the Salesforce effective available-credit value from the uniquely resolved credit-authority snapshot." sources={['Resolved Salesforce credit authority and its applicable credit category.']} asOf={evidenceAsOf} />
        {availableComparison.materiallyDifferent ? <CreditKpi label="Calculated category available" value={calculatedAvailable} currency={currency} detail={availableDifferenceDetail} warning formula={availableComparison.formula} sources={['Applicable Salesforce limit fields and reconciled exact Account/GROUP used-credit exposure.']} exclusions={['Displayed only when it differs from Salesforce effective available credit by more than USD 1.']} asOf={evidenceAsOf} /> : null}
      </div>
    </section>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Remaining credit exposure forecast</h3><p className="mt-1 text-xs text-muted-foreground">Square step lines stay flat until an evidenced release date, then descend. Dense views are bucketed {result.chart?.granularity || 'by day'} without changing exact row details.</p></div><div className="flex flex-wrap items-center justify-end gap-2"><CreditStatementSideToggle value={statementSide} availableSides={availableStatementSides} onChange={onStatementSideChange} />{quantityRangeAvailable ? <Button type="button" size="sm" variant={showRange ? 'default' : 'outline'} aria-pressed={showRange} onClick={() => setShowRange((visible) => !visible)}>{showRange ? `Range shown · ${rangeScope === 'group' ? 'GROUP' : 'Account'}` : 'Show quantity range'}</Button> : null}<div className="flex rounded-md border border-border p-1">{entityType !== 'group' ? <button type="button" aria-pressed={series.account} className={`rounded px-3 py-1 text-xs font-semibold ${series.account ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setSeries((value) => ({ ...value, account: !value.account }))}>Selected Account</button> : null}{result.group ? <button type="button" aria-pressed={series.group} className={`rounded px-3 py-1 text-xs font-semibold ${series.group ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setSeries((value) => ({ ...value, group: !value.group }))}>{entityType === 'group' ? 'Selected GROUP Accounts' : 'GROUP'}</button> : null}</div></div></div><div className="mt-3"><CreditForecastConservativenessControl settings={result.forecastSettings} disabled={loading} onChange={setForecastConservativeness} onSaved={(saved) => setResult((current) => current ? { ...current, forecastSettings: { ...current.forecastSettings, ...saved, companyConservativeness: saved.companyConservativeness, effectiveConservativeness: saved.companyConservativeness, temporaryPreview: false } } : current)} /></div><div className="mt-4"><ReleaseChart data={result} series={chartSeries} showRange={showRange} rangeScope={rangeScope} /></div>{showAssumptions && result.chart?.undatedGroupStemCount ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><div className="font-semibold">Exposure retained without an evidenced future release date</div>{entityType !== 'group' ? <div className="mt-1">Selected Account: {money(result.chart.undatedExposure?.individual, currency)} across {result.chart.undatedAccountStemCount} STEM{result.chart.undatedAccountStemCount === 1 ? '' : 's'}</div> : null}{result.group ? <div>{entityType === 'group' ? 'Selected GROUP Accounts' : 'GROUP'}: {money(result.chart.undatedExposure?.group, currency)} across {result.chart.undatedGroupStemCount} STEM{result.chart.undatedGroupStemCount === 1 ? '' : 's'}</div> : null}<div className="mt-2 flex flex-wrap gap-2">{result.chart.undatedStems?.map((stem) => <button key={stem.stemId} type="button" className="font-semibold text-amber-950 underline underline-offset-2" onClick={() => onStemClick(stem.stemId)}>{stem.stemName} · {money(stem.amount, currency)}</button>)}</div></div> : null}</section>
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div><h3 className="font-semibold">Statement evidence</h3><p className="mt-1 text-xs text-muted-foreground">{result.groupScope?.selectable ? 'Only buyer-leg STEMs for the selected GROUP Accounts are included.' : 'Only STEM__c.Account__c equals this Account.'} Statement Evidence always excludes delivery dates before 1 January 2026, including in Open + 12 months settled and All history.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 text-xs text-muted-foreground">{selectedInvoiceRows.length ? <><span className="font-semibold text-foreground">{selectedInvoiceRows.length} selected</span>{Object.entries(selectedInvoiceTotals).map(([totalCurrency, total]) => <span key={totalCurrency}> · Total invoice amount {money(total.amount, totalCurrency)}{total.hasExpected ? ' (expected)' : ''}</span>)}{selectedNotIssuedCount ? <span className="font-semibold text-red-700"> · {selectedNotIssuedCount} Not Issued</span> : null}</> : `${selectableInvoiceRows.length} statement STEM${selectableInvoiceRows.length === 1 ? '' : 's'} available`}</div>
          <Button type="button" size="sm" variant="outline" onClick={toggleAllInvoices} disabled={!selectableInvoiceRows.length}>{selectedInvoiceRows.length === selectableInvoiceRows.length && selectableInvoiceRows.length ? 'Clear selection' : 'Select all'}</Button>
          <Button type="button" size="sm" onClick={copySelectedInvoices} disabled={!selectedInvoiceRows.length} className="gap-2">{copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copyState === 'copied' ? 'Copied' : 'Copy details'}</Button>
        </div>
      </div>
      {copyError ? <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{copyError}</div> : null}
      <div className="space-y-3 p-4 md:hidden">{rows.map((row) => <StatementCard key={row.stemId} row={row} currency={currency} onStemClick={onStemClick} selected={selectedInvoiceIds.has(row.stemId)} onSelect={toggleInvoice} />)}</div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2"><input type="checkbox" aria-label="Select all statement STEMs on this page" checked={selectableInvoiceRows.length > 0 && selectedInvoiceRows.length === selectableInvoiceRows.length} disabled={!selectableInvoiceRows.length} onChange={toggleAllInvoices} /></th><th className="px-3 py-2">STEM</th><th className="px-3 py-2 text-right">Buyer invoice</th><th className="px-3 py-2">Delivery</th><th className="px-3 py-2 text-right">Current credit exposure</th><th className="px-3 py-2">Quantity exposure range</th><th className="px-3 py-2 text-right">Actual released</th><th className="px-3 py-2">Next release</th><th className="px-3 py-2">Exact evidence</th></tr></thead>
          <tbody>{rows.map((row) => {
            const selectable = statementRowSelectable(row);
            return <tr key={row.stemId} className={`border-t border-border align-top ${row.hasBuyerInvoice ? '' : 'bg-red-50/70'}`}><td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${row.stemName} statement evidence`} checked={selectedInvoiceIds.has(row.stemId)} disabled={!selectable} title={!selectable ? row.expectedBuyerInvoiceAmountBlockingReason || 'Invoice amount unavailable' : undefined} onChange={() => toggleInvoice(row)} /></td><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStemClick(row.stemId)}>{row.stemName}</button><div className="text-xs text-muted-foreground">{row.accountName || result.identity.name}</div>{row.inCreditProjection === false ? <div className="mt-1 text-[10px] font-semibold text-slate-600">Outside current credit lineage window</div> : null}</td><td className="px-3 py-3 text-right tabular-nums">{row.hasBuyerInvoice ? row.buyerInvoiceAmountComplete ? money(row.buyerInvoiceAmount, row.currency || currency) : <span className="text-xs text-amber-700">Amount unavailable</span> : <div className="text-xs font-semibold text-red-800"><div>Not Issued</div><div className="mt-1 font-medium">Conservative expected {row.expectedBuyerInvoiceAmountComplete ? <>{money(row.expectedBuyerInvoiceAmount, row.currency || currency)}{expectedInvoiceBasisSuffix(row)}</> : 'amount unavailable'}</div></div>}</td><td className="px-3 py-3">{displayDate(row.effectiveDate)}</td><td className="px-3 py-3 text-right tabular-nums" title={row.statementExposureComplete ? undefined : row.statementExposureBlockingReason || 'Exposure unavailable'}>{row.statementExposureComplete ? <>{money(row.statementExposureAmount, row.currency || currency)}{statementExposureBasisSuffix(row)}</> : <><span className="text-xs text-amber-700">Unavailable</span><div className="mt-1 max-w-48 text-[10px] text-amber-700">{row.statementExposureBlockingReason || 'Exposure evidence is incomplete.'}</div></>}</td><td className={`max-w-64 px-3 py-3 text-xs ${row.exposureRange?.complete ? '' : 'text-amber-700'}`}>{rangeSummary(row, row.currency || currency)}</td><td className="px-3 py-3 text-right tabular-nums">{money(row.actualReleased, row.currency || currency)}</td><td className="px-3 py-3"><div>{displayDate(row.releaseDate)}</div><div className="text-xs text-muted-foreground">{row.releaseSourceLabel || 'No reliable future date'}</div></td><td className="space-y-1 px-3 py-3 text-xs">{row.actualReleases?.map((release) => <div key={`actual:${release.paymentId}`}><span className="font-medium">{displayDate(release.date)} · Actual payment</span> · {money(release.amount, row.currency || currency)}</div>)}{row.forecastEvents?.map((release, index) => <div key={`forecast:${release.paymentId || release.cashflowId || index}`}><span className="font-medium">{displayDate(release.date)} · {release.sourceLabel}</span> · {money(release.amount, row.currency || currency)}</div>)}{!row.actualReleases?.length && !row.forecastEvents?.length ? <span className="text-muted-foreground">No payment or reliable forecast evidence.</span> : null}</td></tr>;
          })}{!rows.length ? <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No buyer-leg STEMs match this statement scope.</td></tr> : null}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border p-4"><span className="text-xs text-muted-foreground">Page {navigation.history.length + 1}{result.statement.total == null ? '' : ` · ${result.statement.total} matching STEMs`}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!navigation.history.length || loading} onClick={() => load({ cursor: navigation.history.at(-1) || null, history: navigation.history.slice(0, -1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={!nextCursor || loading} onClick={() => load({ cursor: nextCursor, history: [...navigation.history, navigation.cursor] })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
    </section>
  </div>;
}
