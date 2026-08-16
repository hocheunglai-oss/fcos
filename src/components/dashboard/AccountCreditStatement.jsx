import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';

const SCOPES = [
  { value: 'open_recent', label: 'Open + 12 months settled' },
  { value: 'open', label: 'Open only' },
  { value: 'all', label: 'All history' },
];

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value, currency) {
  const amount = numeric(value);
  if (amount == null) return 'Unavailable';
  return `${currency || 'USD'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function displayDate(value) {
  if (!value) return 'Release date unknown';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function CreditKpi({ label, value, currency, detail, warning = false }) {
  return <div className={`rounded-lg border p-3 ${warning ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{money(value, currency)}</div>{detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}</div>;
}

function ReconciliationBadge({ label, result }) {
  if (result?.notApplicable) return <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{label}: no GROUP projection</span>;
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${result?.matches ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{label}: {result?.matches ? 'Reconciled' : 'Projection hidden'}</span>;
}

function ReleaseTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  return <div className="max-w-sm rounded-md border border-border bg-background p-3 text-xs shadow-lg"><div className="font-semibold">Forecast bucket {displayDate(label)}</div>{point.events?.length ? <div className="mt-2 space-y-2">{point.events.map((event) => <div key={`${event.stemId}:${event.date}:${event.source}`}><div className="font-medium">{event.stemName} · {money(event.amount, currency)}</div><div className="text-muted-foreground">Exact date {displayDate(event.date)} · {event.sourceLabel}{event.accountName ? ` · ${event.accountName}` : ''}</div></div>)}</div> : <div className="mt-1 text-muted-foreground">Current authoritative balance</div>}</div>;
}

function ReleaseChart({ data, series }) {
  const chart = data.chart;
  const credit = data.credit;
  if (!data.complete || !chart?.exactEventCount || (!data.reconciliation?.individual?.matches && !data.reconciliation?.group?.matches)) {
    return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">A complete, reconciled future release projection is not available. Exact STEM evidence remains in the statement below.</div>;
  }
  return <div className="h-[340px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart.points} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(value) => String(value).slice(5)} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} /><Tooltip content={<ReleaseTooltip currency={credit.currency} />} /><Legend wrapperStyle={{ fontSize: 11 }} />{series.account ? <Bar dataKey="accountRelease" name="Selected Account release" stackId="release" fill="#0284c7" radius={[3, 3, 0, 0]} /> : null}{series.group ? <Bar dataKey="otherGroupRelease" name="Other GROUP release" stackId="release" fill="#94a3b8" radius={[3, 3, 0, 0]} /> : null}{series.account && data.reconciliation.individual.matches ? <Line type="stepAfter" dataKey="individualBalance" name="Individual available" stroke="#0369a1" strokeWidth={2.5} dot={false} connectNulls={false} /> : null}{series.group && data.reconciliation.group.matches ? <Line type="stepAfter" dataKey="groupBalance" name="GROUP available" stroke="#7c3aed" strokeWidth={2.5} dot={false} connectNulls={false} /> : null}{series.account && numeric(credit.individualLimit) != null ? <ReferenceLine y={credit.individualLimit} stroke="#0369a1" strokeDasharray="4 4" label={{ value: 'Individual base', fontSize: 10 }} /> : null}{series.account && numeric(credit.specialIndividualLimit) != null ? <ReferenceLine y={credit.specialIndividualLimit} stroke="#0d9488" strokeDasharray="4 4" label={{ value: 'Special individual', fontSize: 10 }} /> : null}{series.group && numeric(credit.groupLimit) != null ? <ReferenceLine y={credit.groupLimit} stroke="#7c3aed" strokeDasharray="4 4" label={{ value: 'GROUP base', fontSize: 10 }} /> : null}{series.group && numeric(credit.specialGroupLimit) ? <ReferenceLine y={numeric(credit.groupLimit) + numeric(credit.specialGroupLimit)} stroke="#a855f7" strokeDasharray="4 4" label={{ value: 'GROUP + special', fontSize: 10 }} /> : null}</ComposedChart></ResponsiveContainer></div>;
}

function StatementCard({ row, currency, onStemClick }) {
  const rowCurrency = row.currency || currency;
  return <article className="rounded-lg border border-border bg-card p-4"><button type="button" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStemClick(row.stemId)}>{row.stemName}</button><div className="mt-1 text-xs text-muted-foreground">{row.accountName || 'Selected Account'} · {displayDate(row.effectiveDate)}</div><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Current exposure</dt><dd className="font-semibold">{money(row.currentExposure, rowCurrency)}</dd></div><div><dt className="text-xs text-muted-foreground">Actual released</dt><dd className="font-semibold">{money(row.actualReleased, rowCurrency)}</dd></div><div className="col-span-2"><dt className="text-xs text-muted-foreground">Release evidence</dt><dd className="mt-1 space-y-1">{row.actualReleases?.map((release) => <div key={`actual:${release.paymentId}`}><span className="font-medium">{displayDate(release.date)} · Actual payment</span> · {money(release.amount, rowCurrency)}</div>)}{row.forecastEvents?.map((release, index) => <div key={`forecast:${release.paymentId || release.cashflowId || index}`}><span className="font-medium">{displayDate(release.date)} · {release.sourceLabel}</span> · {money(release.amount, rowCurrency)}</div>)}{!row.actualReleases?.length && !row.forecastEvents?.length ? <div className="text-muted-foreground">No payment or reliable forecast evidence.</div> : null}</dd></div></dl></article>;
}

export default function AccountCreditStatement({ accountId, active, onStemClick }) {
  const [scope, setScope] = useState('open_recent');
  const [result, setResult] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [] });
  const [series, setSeries] = useState({ account: true, group: true });
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
        accountId, scope, cursor, limit: 50, force,
      }, { cache: true, cacheTtlMs: 60_000, cacheTags: ['dashboard', 'account-credit', `account:${accountId}`], signal: controller.signal, force });
      if (controller.signal.aborted) return;
      if (response.data?.error) throw new Error(response.data.error);
      setResult(response.data);
      setNavigation({ cursor, history });
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'The live credit statement could not be loaded.');
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [accountId, active, scope]);

  useEffect(() => { if (active) load(); return () => requestRef.current?.abort(); }, [active, load]);
  const rows = result?.statement?.rows || [];
  const currency = result?.credit?.currency;
  const nextCursor = result?.statement?.nextCursor;
  const calculatedAvailable = result?.credit?.calculatedAvailable;
  const kpis = useMemo(() => result ? [
    ['Individual base', result.credit.individualLimit], ['Individual special', result.credit.specialIndividualLimit],
    ['Individual used', result.credit.usedCustomer], ['Individual balance', result.reconciliation.individual.matches ? result.credit.individualBalance : null],
    ['GROUP base', result.credit.groupLimit], ['GROUP special', result.credit.specialGroupLimit],
    ['GROUP used', result.credit.usedGroup], ['GROUP balance', result.reconciliation.group.matches ? result.credit.groupBalance : null],
  ] : [], [result]);

  if (!active) return null;
  if (loading && !result) return <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading live buyer-leg credit statement…</div>;
  if (error && !result) return <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}<Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => load()}>Retry</Button></div>;
  if (!result) return null;

  return <div className="space-y-5" data-testid="account-credit-statement">
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-semibold">Buyer-leg Credit Statement</h2><p className="mt-1 text-xs text-muted-foreground">{result.identity.name}{result.group ? ` · Ultimate GROUP ${result.group.name} · ${result.group.memberCount} hierarchy Accounts` : ' · No Salesforce GROUP ancestor'} · {currency}</p></div><div className="flex flex-wrap gap-2">{SCOPES.map((item) => <Button key={item.value} type="button" size="sm" variant={scope === item.value ? 'default' : 'outline'} onClick={() => { setResult(null); setNavigation({ cursor: null, history: [] }); setScope(item.value); }}>{item.label}</Button>)}<Button type="button" size="icon" variant="ghost" aria-label="Refresh Credit Statement" onClick={() => load({ cursor: navigation.cursor, history: navigation.history, force: true })} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div></div>
    {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
    {result.warnings?.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle className="h-4 w-4" />Projection safeguards</div><ul className="mt-2 space-y-1 text-xs text-amber-900">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : null}
    <div className="flex flex-wrap gap-2"><ReconciliationBadge label="Individual" result={result.reconciliation.individual} /><ReconciliationBadge label="GROUP" result={result.reconciliation.group} /><span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">Category: {result.credit.category || 'Unavailable'}</span></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{kpis.map(([label, value]) => <CreditKpi key={label} label={label} value={value} currency={currency} warning={value == null && /balance/i.test(label)} />)}</div>
    <div className="grid gap-3 sm:grid-cols-3"><CreditKpi label="Salesforce effective available" value={result.credit.salesforceAvailable} currency={currency} detail="Authoritative CL_Available_Credit__c" /><CreditKpi label="Calculated category available" value={calculatedAvailable} currency={currency} detail="Uses the authoritative Salesforce CL category formula" /><CreditKpi label="Legacy Credit_Limit__c" value={result.credit.legacyLimit} currency={currency} detail="Informational only; not used in the forecast" /></div>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Credit release forecast</h3><p className="mt-1 text-xs text-muted-foreground">Release bars use exact evidence dates; dense views are bucketed {result.chart?.granularity || 'by day'} without changing row details.</p></div><div className="flex rounded-md border border-border p-1"><button type="button" aria-pressed={series.account} className={`rounded px-3 py-1 text-xs font-semibold ${series.account ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setSeries((value) => ({ ...value, account: !value.account }))}>Selected Account</button><button type="button" aria-pressed={series.group} className={`rounded px-3 py-1 text-xs font-semibold ${series.group ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setSeries((value) => ({ ...value, group: !value.group }))}>GROUP</button></div></div><div className="mt-4"><ReleaseChart data={result} series={series} /></div></section>
    <section className="rounded-xl border border-border bg-card"><div className="border-b border-border p-4"><h3 className="font-semibold">Statement evidence</h3><p className="mt-1 text-xs text-muted-foreground">Only STEM__c.Account__c equals this Account. Actual releases cover the previous 12 months in the default view.</p></div><div className="space-y-3 p-4 md:hidden">{rows.map((row) => <StatementCard key={row.stemId} row={row} currency={currency} onStemClick={onStemClick} />)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1120px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">STEM</th><th className="px-3 py-2">Delivery</th><th className="px-3 py-2 text-right">Current exposure</th><th className="px-3 py-2 text-right">Actual released</th><th className="px-3 py-2">Next release</th><th className="px-3 py-2">Exact evidence</th></tr></thead><tbody>{rows.map((row) => <tr key={row.stemId} className="border-t border-border align-top"><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStemClick(row.stemId)}>{row.stemName}</button><div className="text-xs text-muted-foreground">{row.accountName || result.identity.name}</div></td><td className="px-3 py-3">{displayDate(row.effectiveDate)}</td><td className="px-3 py-3 text-right tabular-nums">{money(row.currentExposure, row.currency || currency)}</td><td className="px-3 py-3 text-right tabular-nums">{money(row.actualReleased, row.currency || currency)}</td><td className="px-3 py-3"><div>{displayDate(row.releaseDate)}</div><div className="text-xs text-muted-foreground">{row.releaseSourceLabel || 'No reliable future date'}</div></td><td className="space-y-1 px-3 py-3 text-xs">{row.actualReleases?.map((release) => <div key={`actual:${release.paymentId}`}><span className="font-medium">{displayDate(release.date)} · Actual payment</span> · {money(release.amount, row.currency || currency)}</div>)}{row.forecastEvents?.map((release, index) => <div key={`forecast:${release.paymentId || release.cashflowId || index}`}><span className="font-medium">{displayDate(release.date)} · {release.sourceLabel}</span> · {money(release.amount, row.currency || currency)}</div>)}{!row.actualReleases?.length && !row.forecastEvents?.length ? <span className="text-muted-foreground">No payment or reliable forecast evidence.</span> : null}</td></tr>)}{!rows.length ? <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No buyer-leg STEMs match this statement scope.</td></tr> : null}</tbody></table></div><div className="flex items-center justify-between border-t border-border p-4"><span className="text-xs text-muted-foreground">Page {navigation.history.length + 1}{result.statement.total == null ? '' : ` · ${result.statement.total} matching STEMs`}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!navigation.history.length || loading} onClick={() => load({ cursor: navigation.history.at(-1) || null, history: navigation.history.slice(0, -1) })}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={!nextCursor || loading} onClick={() => load({ cursor: nextCursor, history: [...navigation.history, navigation.cursor] })}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div></section>
  </div>;
}
