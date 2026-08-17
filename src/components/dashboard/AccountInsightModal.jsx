import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Calculator, Download, FileSpreadsheet, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataStatus from '@/components/common/DataStatus';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';

const PERIODS = [
  { value: 'dashboard_period', label: 'Dashboard Period' },
  { value: 'trailing_12', label: 'Trailing 12 Months' },
  { value: 'all_history', label: 'All History' },
];

const ROLE_LABELS = { buyer: 'Buyer', supplier: 'Supplier', group: 'GROUP' };
const AccountCreditStatement = lazy(() => import('@/components/dashboard/AccountCreditStatement'));

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, digits = 0) {
  const parsed = number(value);
  return parsed == null ? 'Unavailable' : parsed.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatMoney(value, currency = '') {
  const parsed = number(value);
  return parsed == null ? 'Unavailable' : `${currency ? `${currency} ` : ''}${parsed.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercent(value) {
  const parsed = number(value);
  return parsed == null ? 'Unavailable' : `${parsed.toFixed(1)}%`;
}

function formatDays(value, digits = 0) {
  return number(value) == null ? 'Unavailable' : `${formatNumber(value, digits)} days`;
}

function formatDate(value) {
  if (!value) return 'Unavailable';
  try { return format(new Date(`${String(value).slice(0, 10)}T00:00:00`), 'dd MMM yyyy'); } catch { return String(value); }
}

function Kpi({ label, value, detail, tone = 'default' }) {
  const tones = {
    default: 'border-border bg-background',
    positive: 'border-emerald-200 bg-emerald-50/60',
    warning: 'border-amber-200 bg-amber-50/60',
    danger: 'border-red-200 bg-red-50/60',
  };
  return (
    <div className={`min-h-24 rounded-md border p-3 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-bold text-foreground">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function Section({ title, description, children, action }) {
  return (
    <section className="border-b border-border pb-5 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children = 'No matching information is available.' }) {
  return <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function Distribution({ rows = [], valueFormatter = formatNumber }) {
  if (!rows.length) return <Empty />;
  const maximum = Math.max(...rows.map((row) => Math.abs(number(row.value) || 0)), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(8rem,12rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate font-medium" title={row.label}>{row.label}</span>
          <div className="h-2 overflow-hidden rounded-sm bg-muted">
            <div className="h-full bg-sky-600" style={{ width: `${Math.max(2, (Math.abs(number(row.value) || 0) / maximum) * 100)}%` }} />
          </div>
          <span className="tabular-nums text-muted-foreground">{valueFormatter(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MoneyRows({ rows = [], columns }) {
  if (!rows.length) return <Empty>Financial values are unavailable for this period.</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr><th className="px-3 py-2">Currency</th>{columns.map((column) => <th key={column.key} className="px-3 py-2 text-right">{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.currency} className="border-t border-border"><td className="px-3 py-2 font-semibold">{row.currency}</td>{columns.map((column) => <td key={column.key} className="px-3 py-2 text-right tabular-nums">{formatMoney(row[column.key], row.currency)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Comparison({ value, suffix = '%' }) {
  const parsed = number(value);
  if (parsed == null) return <span className="text-muted-foreground">No comparison</span>;
  return <span className={parsed >= 0 ? 'text-emerald-700' : 'text-red-700'}>{parsed >= 0 ? '+' : ''}{parsed.toFixed(1)}{suffix}</span>;
}

export default function AccountInsightModal({ account, open, onClose, selectedYears, selectedMonths, dashboardScope = null, initialPeriodMode = 'dashboard_period', onViewChange }) {
  const safeInitialPeriod = PERIODS.some((period) => period.value === initialPeriodMode) ? initialPeriodMode : 'dashboard_period';
  const [periodMode, setPeriodMode] = useState(safeInitialPeriod);
  const [role, setRole] = useState(account?.role || 'buyer');
  const [sections, setSections] = useState({});
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [accountWide, setAccountWide] = useState(dashboardScope?.mode === 'account_wide');
  const [showCalculation, setShowCalculation] = useState(false);
  const [readySelection, setReadySelection] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const requestSequence = useRef(0);
  const selectionKey = account?.accountId ? `${account.accountId}:${account.role || 'buyer'}` : null;

  const payload = useMemo(() => ({
    accountId: account?.accountId,
    contextRole: role,
    periodMode,
    selectedYears,
    selectedMonths,
    pageSize: 50,
    dashboardScope: accountWide ? { mode: 'account_wide' } : dashboardScope,
  }), [account?.accountId, accountWide, dashboardScope, periodMode, role, selectedMonths, selectedYears]);

  const load = async ({ force = false, cursor = null, append = false, section = activeTab } = {}) => {
    if (!account?.accountId) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const applyResponse = (response) => {
        if (requestId !== requestSequence.current) return;
        setMeta(response.meta);
        if (response.data?.error) setError(response.data.error);
        else if (append) {
          setSections((current) => ({ ...current, [section]: { ...response.data, stems: { ...response.data.stems, rows: [...(current?.[section]?.stems?.rows || []), ...(response.data.stems?.rows || [])] } } }));
        } else {
          setError(null);
          setSections((current) => ({ ...current, [section]: response.data }));
        }
      };
      const response = await appClient.functions.invoke('dashboardAccountInsight', { ...payload, cursor, section }, append
        ? { cache: true, cacheTtlMs: 180_000, force }
        : { ...navigationCacheOptions('operational', applyResponse), force });
      applyResponse(response);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      setError(loadError.message || 'Account Insight could not be loaded.');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !account?.accountId) return;
    if (readySelection === selectionKey) return;
    setPeriodMode(safeInitialPeriod);
    requestSequence.current += 1;
    setRole(account.role || 'buyer');
    setActiveTab(account.initialTab === 'credit' ? 'credit' : 'overview');
    setSections({});
    setAccountWide(dashboardScope?.mode === 'account_wide');
    setShowCalculation(false);
    setError(null);
    setSelectedStemId(null);
    setReadySelection(selectionKey);
  }, [account?.accountId, account?.initialTab, account?.role, dashboardScope?.mode, open, readySelection, safeInitialPeriod, selectionKey]);

  useEffect(() => {
    if (!open || !account?.accountId || readySelection !== selectionKey) return;
    if (activeTab !== 'credit' && !sections[activeTab]) load({ section: activeTab });
  }, [activeTab, open, payload, readySelection, sections, selectionKey]);

  const download = async (formatType) => {
    setExporting(formatType);
    setError(null);
    try {
      const result = await appClient.functions.download('dashboardAccountInsightExport', { ...payload, format: formatType });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError.message || 'The Account Insight report could not be downloaded.');
    } finally {
      setExporting(null);
    }
  };

  const accountInsight = sections[activeTab] || null;
  const data = accountInsight || Object.values(sections)[0] || {
    activeRole: role,
    availableRoles: [role],
    identity: account || {},
    kpis: {},
    payments: {},
    risk: {},
    collection: {},
    relationship: {},
    stems: { rows: [] },
    children: [],
    warnings: [],
  };
  const identity = data.identity || account || {};
  const kpis = data?.kpis || {};
  const trend = kpis.trend || [];
  const buyerPayments = data?.payments?.buyer;
  const supplierPayments = data?.payments?.supplier;
  const dispute = data?.risk?.dispute || {};
  const comparison = data?.comparisons;
  const financialRows = kpis.moneyByCurrency || [];
  const financialCurrency = financialRows.length === 1 ? financialRows[0].currency : '';
  const currencyValue = (rows, key) => rows?.length === 1 ? formatMoney(rows[0][key], rows[0].currency) : rows?.length ? `${rows.length} currencies` : 'Unavailable';
  const creditUtilization = buyerPayments?.byCurrency?.length === 1 && identity.currency && buyerPayments.byCurrency[0].currency === identity.currency && number(identity.creditLimit) > 0
    ? (number(buyerPayments.byCurrency[0].receivable) / number(identity.creditLimit)) * 100
    : null;

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="inset-0 left-0 top-0 h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 sm:left-[50%] sm:top-[50%] sm:h-[92vh] sm:w-[96vw] sm:max-w-[1500px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg">
        <DialogHeader className="border-b border-border bg-background px-5 py-4 pr-12 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-sky-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-sky-800">Account Insight</span>
                <span className="rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold">{ROLE_LABELS[data?.activeRole || role]}</span>
                {meta ? <DataStatus meta={meta} label="Salesforce" /> : null}
              </div>
              <DialogTitle className="truncate text-xl">{identity.name || account?.name || 'Account'}</DialogTitle>
              <DialogDescription>{identity.clKey ? `CL Key ${identity.clKey}` : 'CL Key not set'} · {data?.period?.label || PERIODS.find((item) => item.value === periodMode)?.label}</DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(data?.availableRoles || [role]).length > 1 ? (
                <div className="flex rounded-md border border-border bg-muted/30 p-1">
                  {data.availableRoles.map((availableRole) => <button type="button" key={availableRole} onClick={() => { if (availableRole !== role) { setSections({}); setRole(availableRole); if (availableRole === 'supplier') setActiveTab('overview'); onViewChange?.({ role: availableRole, tab: availableRole === 'supplier' ? 'overview' : activeTab, periodMode, accountWide }); } }} className={`rounded px-3 py-1.5 text-xs font-semibold ${role === availableRole ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>{ROLE_LABELS[availableRole]}</button>)}
                </div>
              ) : null}
              {activeTab !== 'credit' ? <Button type="button" variant="outline" size="sm" onClick={() => load({ force: true, section: activeTab })} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button> : null}
              <Button type="button" variant="outline" size="sm" onClick={() => download('csv')} disabled={Boolean(exporting)}>{exporting === 'csv' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}CSV</Button>
              <Button type="button" size="sm" onClick={() => download('pdf')} disabled={Boolean(exporting)}>{exporting === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}PDF</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {PERIODS.map((period) => <button type="button" key={period.value} onClick={() => { if (period.value !== periodMode) { setSections({}); setPeriodMode(period.value); onViewChange?.({ role, tab: activeTab, periodMode: period.value, accountWide }); } }} className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${periodMode === period.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}>{period.label}</button>)}
            {dashboardScope ? <Button type="button" size="sm" variant={accountWide ? 'outline' : 'secondary'} aria-pressed={!accountWide} onClick={() => { const next = !accountWide; setSections({}); setAccountWide(next); onViewChange?.({ role, tab: activeTab, periodMode, accountWide: next }); }}>{accountWide ? 'Account-wide' : 'Dashboard scope'}</Button> : null}
          </div>
          {dashboardScope && !accountWide ? <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground"><span>Inherited filters:</span>{[dashboardScope.labels?.company, dashboardScope.labels?.group, dashboardScope.labels?.port, dashboardScope.labels?.country, dashboardScope.disputeOnly ? 'Disputed only' : null].filter(Boolean).map((label) => <span key={label} className="rounded-full border border-border bg-background px-2 py-0.5">{label}</span>)}{![dashboardScope.labels?.company, dashboardScope.labels?.group, dashboardScope.labels?.port, dashboardScope.labels?.country, dashboardScope.disputeOnly].some(Boolean) ? <span>period only</span> : null}</div> : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15">
          {error ? <div className="m-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
          {loading && !accountInsight && activeTab !== 'credit' ? <div className="flex h-72 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Building Account Insight...</div> : null}
          {accountInsight || activeTab === 'credit' ? (
            <Tabs value={activeTab} onValueChange={(nextTab) => { setActiveTab(nextTab); onViewChange?.({ role, tab: nextTab, periodMode, accountWide }); }} className="min-h-full">
              <div className="sticky top-0 z-20 overflow-x-auto border-b border-border bg-background/95 px-5 py-2 backdrop-blur sm:px-6">
                <TabsList className="h-10 w-max">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="trading">Trading & Profit</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="risk">Risk & Workflow</TabsTrigger>
                  <TabsTrigger value="stems">STEMs</TabsTrigger>
                  {(data?.activeRole || role) !== 'supplier' ? <TabsTrigger value="credit">Credit Statement</TabsTrigger> : null}
                  {data?.activeRole === 'group' ? <TabsTrigger value="children">Children</TabsTrigger> : null}
                </TabsList>
              </div>

              <div className="mx-auto max-w-[1440px] p-5 sm:p-6">
                {data?.warnings?.length && activeTab !== 'credit' ? <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Data warnings</div><ul className="mt-2 space-y-1 text-xs text-amber-900">{data.warnings.slice(0, 6).map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : null}

                <TabsContent value="credit" className="mt-0"><Suspense fallback={<div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading Credit Statement tools…</div>}><AccountCreditStatement accountId={account?.accountId} active={activeTab === 'credit'} onStemClick={setSelectedStemId} /></Suspense></TabsContent>

                <TabsContent value="overview" className="mt-0 space-y-5">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
                    <Kpi label="STEMs" value={formatNumber(kpis.stemCount)} detail={`${formatNumber(kpis.deliveredStems)} delivered`} />
                    <Kpi label="Volume" value={`${formatNumber(kpis.totalVolumeMt, 1)} MT`} detail={<Comparison value={comparison?.volumePct} />} />
                    <Kpi label={data.activeRole === 'supplier' ? 'Allocated Revenue' : 'Turnover'} value={financialRows.length === 1 ? formatMoney(kpis.turnover, financialCurrency) : `${financialRows.length} currencies`} detail={<Comparison value={comparison?.turnoverPct} />} />
                    <Kpi label="Gross Profit" value={financialRows.length === 1 ? formatMoney(kpis.grossProfit, financialCurrency) : `${financialRows.length} currencies`} detail={<Comparison value={comparison?.grossProfitPct} />} tone={financialRows.length === 1 && number(kpis.grossProfit) < 0 ? 'danger' : financialRows.length === 1 ? 'positive' : 'default'} />
                    <Kpi label="Gross Margin" value={formatPercent(kpis.grossMarginPct)} detail={comparison ? <Comparison value={comparison.grossMarginPointChange} suffix=" pts" /> : 'No comparison'} />
                    <Kpi label="Receivable / Payable" value={data.activeRole === 'supplier' ? currencyValue(supplierPayments?.byCurrency, 'outstandingPayable') : currencyValue(buyerPayments?.byCurrency, 'receivable')} />
                  </div>
                  <Section title="Ranked evidence" description="The strongest operational signals behind this Account summary">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <button type="button" disabled={!kpis.worstStem?.stemId} onClick={() => setSelectedStemId(kpis.worstStem?.stemId)} className="rounded-md border border-red-200 bg-red-50/50 p-3 text-left disabled:opacity-60"><div className="text-[11px] font-semibold uppercase text-red-800">Lowest-profit STEM</div><div className="mt-1 font-semibold text-primary">{kpis.worstStem?.stemName || 'Unavailable'}</div><div className="mt-1 text-xs tabular-nums text-red-800">{formatMoney(kpis.worstStem?.grossProfit, kpis.worstStem?.currency || financialCurrency)}</div></button>
                      <button type="button" disabled={!kpis.bestStem?.stemId} onClick={() => setSelectedStemId(kpis.bestStem?.stemId)} className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-left disabled:opacity-60"><div className="text-[11px] font-semibold uppercase text-emerald-800">Highest-profit STEM</div><div className="mt-1 font-semibold text-primary">{kpis.bestStem?.stemName || 'Unavailable'}</div><div className="mt-1 text-xs tabular-nums text-emerald-800">{formatMoney(kpis.bestStem?.grossProfit, kpis.bestStem?.currency || financialCurrency)}</div></button>
                      <div className="rounded-md border border-border bg-background p-3"><div className="text-[11px] font-semibold uppercase text-muted-foreground">Top product</div><div className="mt-1 font-semibold">{kpis.topProducts?.[0]?.label || 'Unavailable'}</div><div className="mt-1 text-xs text-muted-foreground">{formatPercent(kpis.topProducts?.[0]?.percentage)} of activity</div></div>
                      <div className="rounded-md border border-border bg-background p-3"><div className="text-[11px] font-semibold uppercase text-muted-foreground">Action signals</div><div className="mt-1 font-semibold">{formatNumber(dispute.open)} open disputes</div><div className="mt-1 text-xs text-muted-foreground">{formatNumber(data.risk?.exceptions?.count)} workflow exceptions</div></div>
                    </div>
                  </Section>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Section title="Relationship" description="Salesforce identity and FCOS ownership context">
                      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Record type</dt><dd className="font-medium">{identity.recordType || 'Unavailable'}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">GROUP</dt><dd className="font-medium">{identity.group ? [identity.group.name, identity.group.clKey].filter(Boolean).join(' · ') : 'Not applicable'}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Credit / insurance limit</dt><dd className="font-medium">{number(identity.creditLimit) == null && number(identity.insuranceLimit) == null ? 'Unavailable' : `${formatMoney(identity.creditLimit, identity.currency)} / ${formatMoney(identity.insuranceLimit, identity.currency)}`}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Credit utilization</dt><dd className="font-medium">{formatPercent(creditUtilization)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Risk rating</dt><dd className="font-medium">{identity.creditRating || 'Unavailable'}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">First activity</dt><dd className="font-medium">{formatDate(kpis.firstStemDate)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Last activity</dt><dd className="font-medium">{formatDate(kpis.lastStemDate)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Relationship age</dt><dd className="font-medium">{formatDays(kpis.relationshipAgeDays)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Since last activity</dt><dd className="font-medium">{formatDays(kpis.daysSinceLastActivity)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Active months</dt><dd className="font-medium">{formatNumber(kpis.activeMonths)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Inactive months</dt><dd className="font-medium">{formatNumber(kpis.inactiveMonths)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Average STEMs/month</dt><dd className="font-medium">{formatNumber(kpis.averageStemsPerActiveMonth, 1)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Peak activity</dt><dd className="font-medium">{kpis.peakPeriod?.period || 'Unavailable'}{kpis.peakPeriod ? ` · ${formatNumber(kpis.peakPeriod.volumeMt, 1)} MT` : ''}</dd></div>
                      </dl>
                      <div className="mt-4 border-t border-border pt-3"><div className="text-xs text-muted-foreground">Account Managers · {formatNumber(data.relationship?.managerCoverage)} assigned</div><div className="mt-1 text-sm font-medium">{data.relationship?.accountManagers?.map((manager) => manager.name).join(' · ') || 'Not assigned'}</div>{data.relationship?.accountNote ? <p className="mt-2 text-xs text-muted-foreground">{data.relationship.accountNote}</p> : null}</div>
                    </Section>
                    <Section title="Operational risk" description="Current workflow signals">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                        <Kpi label="Disputed" value={formatNumber(kpis.disputedStems)} detail={formatPercent(kpis.disputeRatePct)} tone={kpis.disputedStems ? 'warning' : 'default'} />
                        <Kpi label="Cancelled" value={formatNumber(kpis.cancelledStems)} detail={formatPercent(kpis.cancellationRatePct)} />
                        <Kpi label="Open disputes" value={formatNumber(dispute.open)} tone={dispute.open ? 'warning' : 'default'} />
                        <Kpi label="Exceptions" value={formatNumber(data.risk?.exceptions?.count)} tone={data.risk?.exceptions?.count ? 'warning' : 'default'} />
                        <Kpi label="Hedge coverage" value={formatPercent(kpis.hedgeCoveragePct)} detail={`${formatNumber(kpis.hedgedStems)} linked STEMs`} />
                        <Kpi label="Special Terms" value={formatNumber(data.risk?.specialTerms?.count)} tone={data.risk?.specialTerms?.count ? 'warning' : 'default'} />
                      </div>
                    </Section>
                  </div>
                  <div><Button type="button" size="sm" variant="outline" aria-expanded={showCalculation} onClick={() => setShowCalculation((visible) => !visible)}><Calculator className="mr-1.5 h-3.5 w-3.5" />{showCalculation ? 'Hide calculation' : 'Explain these figures'}</Button></div>
                  {showCalculation ? <Section title="Calculation evidence" description="The displayed formula and its currency-separated inputs">
                    <div className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-3">{financialRows.map((row) => <div key={row.currency} className="rounded-md border border-border bg-background p-3"><div className="font-semibold">{row.currency}</div><div className="mt-1 tabular-nums">{formatMoney(row.turnover, row.currency)} − {formatMoney(row.supplierSpend, row.currency)} − {formatMoney(row.brokerCommissions, row.currency)} = <strong>{formatMoney(row.grossProfit, row.currency)}</strong></div><div className="mt-1 text-muted-foreground">Gross margin: {formatPercent(row.grossMarginPct)} · {formatNumber(kpis.stemCount)} STEMs</div></div>)}</div>
                    <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-3"><p><strong className="text-foreground">Buyer and GROUP:</strong> complete STEM turnover, costs, commissions, volume and profit are attributed to the buyer.</p><p><strong className="text-foreground">Supplier:</strong> direct revenue and cost are assigned first. Shared commissions and unassigned costs use revenue share, then cost share, then equal share.</p><p><strong className="text-foreground">Volume:</strong> L, KL and CBM are converted to approximate MT for statistics only. These conversions never affect price comparisons.</p></div>
                  </Section> : null}
                </TabsContent>

                <TabsContent value="trading" className="mt-0 space-y-5">
                  <Section title="Financial performance by currency" description="FCOS does not net currencies without an authoritative exchange rate"><MoneyRows rows={financialRows} columns={[{ key: 'turnover', label: data.activeRole === 'supplier' ? 'Allocated revenue' : 'Turnover' }, { key: 'supplierSpend', label: 'Supplier spend' }, { key: 'grossProfit', label: 'Gross Profit' }, { key: 'brokerCommissions', label: 'Broker commissions' }, { key: 'extraCosts', label: 'Extra costs' }, { key: 'uninvoicedCost', label: 'Uninvoiced cost' }]} /></Section>
                  <Section title="Monthly activity" description={`${kpis.trendGranularity === 'year' ? 'Yearly' : 'Monthly'} volume, Gross Profit, and Gross Margin`}>
                    {kpis.currencyTrends?.length ? <div className="grid gap-5 xl:grid-cols-2">{kpis.currencyTrends.map((currencyTrend) => <div key={currencyTrend.currency} className="min-w-0"><div className="mb-2 text-xs font-semibold text-muted-foreground">{currencyTrend.currency}</div><ResponsiveContainer width="100%" height={260}><ComposedChart data={currencyTrend.rows}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis yAxisId="value" tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} /><YAxis yAxisId="margin" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} /><Tooltip formatter={(value, name) => name === 'Gross Margin %' ? [`${Number(value).toFixed(1)}%`, name] : [formatMoney(value, currencyTrend.currency), name]} /><Bar yAxisId="value" dataKey="grossProfit" name="Gross Profit" fill="#0f766e" radius={[3, 3, 0, 0]} /><Line yAxisId="margin" dataKey="grossMarginPct" name="Gross Margin %" stroke="#2563eb" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div>)}</div> : trend.length ? <ResponsiveContainer width="100%" height={300}><ComposedChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis yAxisId="value" tick={{ fontSize: 11 }} /><Bar yAxisId="value" dataKey="volumeMt" name="Volume MT" fill="#0f766e" radius={[3, 3, 0, 0]} /></ComposedChart></ResponsiveContainer> : <Empty />}
                  </Section>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Section title="Product mix" description={`${formatNumber(kpis.distinctProducts)} products across ${formatNumber(kpis.distinctProductFamilies)} families`}><Distribution rows={kpis.productMix} valueFormatter={(value) => `${formatNumber(value, 1)} MT`} /></Section>
                    <Section title="Trading footprint" description={`${formatNumber(kpis.distinctPorts)} ports · ${formatNumber(kpis.distinctCountries)} countries`}><Distribution rows={kpis.topPorts} valueFormatter={(value) => `${formatNumber(value, 1)} MT`} /></Section>
                  </div>
                  <Section title="Average prices" description="Weighted using original quantities only; approximate density conversions are never used for price comparisons">
                    {kpis.averagePrices?.length ? <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Port</th><th className="px-3 py-2">UOM</th><th className="px-3 py-2">Currency</th><th className="px-3 py-2 text-right">Average sell</th><th className="px-3 py-2 text-right">Average buy</th></tr></thead><tbody>{kpis.averagePrices.slice(0, 30).map((row) => <tr key={`${row.period}-${row.product}-${row.port}-${row.unitOfMeasure}-${row.currency}`} className="border-t border-border"><td className="px-3 py-2">{row.period}</td><td className="px-3 py-2 font-medium">{row.product}</td><td className="px-3 py-2">{row.port}</td><td className="px-3 py-2">{row.unitOfMeasure}</td><td className="px-3 py-2">{row.currency}</td><td className="px-3 py-2 text-right">{formatMoney(row.averageSellPrice, row.currency)}</td><td className="px-3 py-2 text-right">{formatMoney(row.averageBuyPrice, row.currency)}</td></tr>)}</tbody></table></div> : <Empty />}
                  </Section>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                    <Kpi label="GP / STEM" value={formatMoney(kpis.gpPerStem, financialCurrency)} />
                    <Kpi label="GP / MT" value={formatMoney(kpis.gpPerMt, financialCurrency)} />
                    <Kpi label="Loss STEMs" value={formatNumber(kpis.lossMakingStems)} detail={formatPercent(kpis.lossRatePct)} tone={kpis.lossMakingStems ? 'danger' : 'default'} />
                    <Kpi label="Profit volatility" value={formatMoney(kpis.profitVolatility, financialCurrency)} detail={`${formatNumber(kpis.negativePeriods)} negative periods`} />
                    <Kpi label="Average volume" value={`${formatNumber(kpis.averageVolumeMt, 1)} MT`} />
                    <Kpi label="Repeat vessel rate" value={formatPercent(kpis.repeatVesselRatePct)} />
                    <Kpi label="Quantity variance" value={`${formatNumber(kpis.quantityVarianceMt, 1)} MT`} detail={`${formatPercent(kpis.underDeliveryRatePct)} under-delivered`} />
                    <Kpi label="Extra costs / turnover" value={formatPercent(kpis.extraCostSharePct)} detail={`${formatPercent(kpis.brokerCommissionPct)} broker commissions`} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                    <Kpi label="Products" value={formatNumber(kpis.distinctProducts)} detail={`${formatNumber(kpis.distinctProductFamilies)} families`} />
                    <Kpi label="Ports" value={formatNumber(kpis.distinctPorts)} detail={`${formatNumber(kpis.distinctCountries)} countries`} />
                    <Kpi label="Vessels" value={formatNumber(kpis.distinctVessels)} detail={`${formatPercent(kpis.repeatVesselRatePct)} repeat`} />
                    <Kpi label="Brokers" value={formatNumber(kpis.distinctBrokers)} />
                    <Kpi label="Currencies" value={formatNumber(kpis.distinctCurrencies)} />
                    <Kpi label="Payment terms" value={formatNumber(kpis.distinctPaymentTerms)} />
                    <Kpi label="Top product share" value={formatPercent(kpis.topOneProductConcentrationPct)} detail={`${formatPercent(kpis.topThreeProductConcentrationPct)} top three`} />
                    <Kpi label="Top port share" value={formatPercent(kpis.topOnePortConcentrationPct)} detail={`${formatPercent(kpis.topThreePortConcentrationPct)} top three`} />
                  </div>
                </TabsContent>

                <TabsContent value="payments" className="mt-0 space-y-5">
                  {data.activeRole === 'supplier' ? (
                    <>
                      <Section title="Supplier payment exposure" description="Currencies remain separate"><MoneyRows rows={supplierPayments?.byCurrency} columns={[{ key: 'invoiceAmount', label: 'Invoiced' }, { key: 'paidAmount', label: 'Paid' }, { key: 'outstandingPayable', label: 'Payable' }, { key: 'overduePayable', label: 'Overdue' }, { key: 'dueWithin7Days', label: 'Due 7 days' }, { key: 'dueWithin30Days', label: 'Due 30 days' }]} /></Section>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8"><Kpi label="Unpaid invoices" value={formatNumber(supplierPayments?.states?.unpaid)} /><Kpi label="Partly paid" value={formatNumber(supplierPayments?.states?.partlyPaid)} /><Kpi label="Paid invoices" value={formatNumber(supplierPayments?.states?.paid)} /><Kpi label="Completion" value={formatPercent(supplierPayments?.completionRatePct)} /><Kpi label="Average payment delay" value={formatDays(supplierPayments?.averagePaymentDelayDays, 1)} /><Kpi label="On-time payments" value={formatPercent(supplierPayments?.onTimePaymentRatePct)} /><Kpi label="Latest payment" value={formatDate(supplierPayments?.latestPayment?.date)} /><Kpi label="Payment terms" value={formatNumber(supplierPayments?.paymentTerms?.length)} /></div>
                    </>
                  ) : (
                    <>
                      <Section title="Buyer collection exposure" description="Salesforce receivable balance remains authoritative"><MoneyRows rows={buyerPayments?.byCurrency} columns={[{ key: 'invoiceAmount', label: 'Invoiced' }, { key: 'paymentsReceived', label: 'Received' }, { key: 'receivable', label: 'Receivable' }, { key: 'overdue', label: 'Overdue' }, { key: 'dueWithin7Days', label: 'Due 7 days' }, { key: 'dueWithin30Days', label: 'Due 30 days' }]} /></Section>
                      <Section title="Receivable aging" description="Outstanding amounts are grouped by overdue days and currency"><MoneyRows rows={buyerPayments?.agingByCurrency} columns={[{ key: 'days1to7', label: '1–7 days' }, { key: 'days8to30', label: '8–30 days' }, { key: 'days31to60', label: '31–60 days' }, { key: 'days61to90', label: '61–90 days' }, { key: 'over90', label: 'Over 90 days' }]} /></Section>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8"><Kpi label="Payments" value={formatNumber(buyerPayments?.paymentCount)} /><Kpi label="Collection rate" value={buyerPayments?.byCurrency?.length === 1 ? formatPercent(buyerPayments.byCurrency[0].collectionPercentagePct) : 'By currency'} /><Kpi label="Weighted DSO" value={formatDays(buyerPayments?.weightedDso, 1)} /><Kpi label="Average delay" value={formatDays(buyerPayments?.averagePaymentDelayDays, 1)} /><Kpi label="Median delay" value={formatDays(buyerPayments?.medianPaymentDelayDays, 1)} /><Kpi label="Maximum delay" value={formatDays(buyerPayments?.maximumPaymentDelayDays)} /><Kpi label="On-time rate" value={formatPercent(buyerPayments?.onTimePaymentRatePct)} /><Kpi label="Latest payment" value={formatDate(buyerPayments?.latestPayment?.paymentDate)} /></div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Kpi label="Full CIA" value={formatNumber(buyerPayments?.cia?.fullCount)} /><Kpi label="Partial CIA" value={formatNumber(buyerPayments?.cia?.partialCount)} /><Kpi label="Partial Payment" value={formatNumber(buyerPayments?.cia?.partialPaymentCount)} /><Kpi label="Full Payment" value={formatNumber(buyerPayments?.cia?.fullPaymentCount)} /></div>
                      {buyerPayments?.cia?.byCurrency?.length ? <Section title="CIA and payment values" description="Payment evidence uses the later available earliest ETA or actual delivery boundary"><MoneyRows rows={buyerPayments.cia.byCurrency} columns={[{ key: 'fullValue', label: 'Full CIA' }, { key: 'partialValue', label: 'Partial CIA' }, { key: 'partialPaymentValue', label: 'Partial Payment' }]} /></Section> : null}
                      <Section title="Collection workflow" description={`Live FCOS collection state · Reminder policy: ${data.collection?.reminderPolicy?.policy === 'overdue_only' ? 'Overdue only' : data.collection?.reminderPolicy?.policy === 'standard' ? 'Standard' : 'Unavailable'}`}><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8"><Kpi label="Needs action" value={formatNumber(data.collection?.needsAction)} tone={data.collection?.needsAction ? 'warning' : 'default'} /><Kpi label="Missed promises" value={formatNumber(data.collection?.missedPromises)} tone={data.collection?.missedPromises ? 'danger' : 'default'} /><Kpi label="Payment advice" value={formatNumber(data.collection?.unverifiedPaymentAdvice)} /><Kpi label="Overdue follow-ups" value={formatNumber(data.collection?.overdueFollowUps)} /><Kpi label="Reminders sent" value={formatNumber(data.collection?.remindersSent)} /><Kpi label="Escalated" value={formatNumber(data.collection?.escalations)} /><Kpi label="On hold" value={formatNumber(data.collection?.holds)} /><Kpi label="Reconciliation" value={formatNumber(data.collection?.reconciliationExceptions)} /></div></Section>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="risk" className="mt-0 space-y-5">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8"><Kpi label="Open disputes" value={formatNumber(dispute.open)} /><Kpi label="Closed disputes" value={formatNumber(dispute.closed)} /><Kpi label="Average open age" value={formatDays(dispute.averageOpenAgeDays, 1)} /><Kpi label="Open instructions" value={formatNumber(dispute.openInstructions)} /><Kpi label="Commercial amount" value={dispute.actionAmounts?.length === 1 ? formatMoney(dispute.commercialAmount, dispute.actionAmounts[0].currency) : dispute.actionAmounts?.length ? `${dispute.actionAmounts.length} currencies` : 'Unavailable'} /><Kpi label="Do not pay" value={dispute.instructionAmounts?.length === 1 ? formatMoney(dispute.holdAmount, dispute.instructionAmounts[0].currency) : dispute.instructionAmounts?.length ? `${dispute.instructionAmounts.length} currencies` : 'Unavailable'} /><Kpi label="Get back" value={dispute.instructionAmounts?.length === 1 ? formatMoney(dispute.getBackAmount, dispute.instructionAmounts[0].currency) : dispute.instructionAmounts?.length ? `${dispute.instructionAmounts.length} currencies` : 'Unavailable'} /><Kpi label="Exceptions overdue" value={formatNumber(data.risk?.exceptions?.overdue)} tone={data.risk?.exceptions?.overdue ? 'danger' : 'default'} /></div>
                  {dispute.instructionAmounts?.length ? <Section title="Supplier accounting instructions" description="Amounts remain separated by instruction currency"><MoneyRows rows={dispute.instructionAmounts} columns={[{ key: 'holdAmount', label: 'Do not pay' }, { key: 'getBackAmount', label: 'Get back paid amount' }]} /></Section> : null}
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Section title="Unofficial Compensation" description="Agreed, recovered, and outstanding amounts by currency"><MoneyRows rows={(data.risk?.compensation || []).map((row) => ({ ...row, currency: row.currency }))} columns={[{ key: 'agreed', label: 'Agreed' }, { key: 'recovered', label: 'Recovered' }, { key: 'outstanding', label: 'Outstanding' }, { key: 'overdue', label: 'Overdue' }]} /></Section>
                    <Section title="Special Terms" description="Applicable Salesforce rules are contractual warnings"><div className="space-y-2">{data.risk?.specialTerms?.terms?.length ? data.risk.specialTerms.terms.map((term) => <div key={term.ruleId} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"><div className="font-semibold text-amber-950">{term.termName}</div><div className="text-xs text-amber-800">{term.ruleName} · {term.audience}</div></div>) : <Empty>No applicable Special Terms were found.</Empty>}</div></Section>
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2"><Section title="Dispute closure outcomes" description="Exact Account-party outcomes"><Distribution rows={dispute.closureOutcomes} /></Section><Section title="Exception reasons" description="Live Exception Review workflow signals"><Distribution rows={data.risk?.exceptions?.reasons} /></Section></div>
                  <Section title="Data quality" description="Unavailable values are not treated as zero"><div className="space-y-2">{data.risk?.dataQualityWarnings?.length ? data.risk.dataQualityWarnings.map((warning) => <div key={warning} className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span>{warning}</span></div>) : <Empty />}</div></Section>
                  <Section title="Unavailable comparisons" description="FCOS does not infer unsupported Account-level figures"><div className="space-y-2">{data.risk?.unavailableKpis?.map((warning) => <div key={warning} className="text-sm text-muted-foreground">{warning}</div>)}</div></Section>
                </TabsContent>

                <TabsContent value="stems" className="mt-0">
                  <Section title="Underlying STEMs" description={`${formatNumber(data.stems?.rows?.length)} shown · ${formatNumber(data.stems?.total)} matched`} action={data.stems?.cursor ? <Button type="button" variant="outline" size="sm" onClick={() => load({ cursor: data.stems.cursor, append: true, section: 'stems' })} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Load more</Button> : null}>
                    <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">STEM</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Products</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-right">Turnover</th><th className="px-3 py-2 text-right">Gross Profit</th><th className="px-3 py-2">Status</th></tr></thead><tbody>{data.stems?.rows?.map((row) => <tr key={row.stemId} className="border-t border-border"><td className="px-3 py-2 font-semibold"><button type="button" className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedStemId(row.stemId)}>{row.stemName}</button></td><td className="px-3 py-2">{formatDate(row.effectiveDate)}</td><td className="max-w-80 px-3 py-2"><div className="truncate" title={row.products?.map((item) => item.name).join(', ')}>{row.products?.map((item) => item.name).join(', ') || '—'}</div></td><td className="px-3 py-2 text-right">{formatNumber(row.volumeMt, 1)} MT</td><td className="px-3 py-2 text-right">{formatMoney(row.turnover, row.currency)}</td><td className={`px-3 py-2 text-right font-semibold ${number(row.grossProfit) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney(row.grossProfit, row.currency)}</td><td className="px-3 py-2">{row.disputed ? <span className="rounded-sm bg-amber-100 px-2 py-1 text-xs text-amber-900">{row.disputeStatus || 'Disputed'}</span> : row.status}</td></tr>)}{!data.stems?.rows?.length ? <tr><td colSpan={7}><Empty /></td></tr> : null}</tbody></table></div>
                  </Section>
                </TabsContent>

                {data.activeRole === 'group' ? <TabsContent value="children" className="mt-0"><Section title="GROUP children" description={`${formatNumber(data.relationship?.activeChildCount)} active · ${formatNumber(data.relationship?.childrenWithoutManagers)} without Account Managers`}><div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Kpi label="Child Accounts" value={formatNumber(data.relationship?.childCount)} /><Kpi label="Trading children" value={formatNumber(data.relationship?.tradingChildCount)} /><Kpi label="Top child share" value={formatPercent(data.relationship?.topChildConcentrationPct)} /><Kpi label="Without managers" value={formatNumber(data.relationship?.childrenWithoutManagers)} tone={data.relationship?.childrenWithoutManagers ? 'warning' : 'default'} /></div><div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Managers</th><th className="px-3 py-2 text-right">STEMs</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-right">Volume share</th><th className="px-3 py-2 text-right">Turnover</th><th className="px-3 py-2 text-right">Turnover share</th><th className="px-3 py-2 text-right">Gross Profit</th><th className="px-3 py-2 text-right">Receivable</th></tr></thead><tbody>{data.children?.map((child) => <tr key={child.accountId} className="border-t border-border"><td className="px-3 py-2"><div className="font-semibold">{child.name}</div><div className="text-xs text-muted-foreground">{child.clKey || 'CL Key not set'}</div></td><td className="px-3 py-2 text-right">{formatNumber(child.managerCount)}</td><td className="px-3 py-2 text-right">{formatNumber(child.stemCount)}</td><td className="px-3 py-2 text-right">{formatNumber(child.volumeMt, 1)} MT</td><td className="px-3 py-2 text-right">{formatPercent(child.volumeContributionPct)}</td><td className="px-3 py-2 text-right">{currencyValue(child.moneyByCurrency, 'turnover')}</td><td className="px-3 py-2 text-right">{formatPercent(child.turnoverContributionPct)}</td><td className="px-3 py-2 text-right">{currencyValue(child.moneyByCurrency, 'grossProfit')}</td><td className="px-3 py-2 text-right">{child.moneyByCurrency?.length === 1 ? formatMoney(child.receivable, child.moneyByCurrency[0].currency) : child.moneyByCurrency?.length ? 'By currency' : 'Unavailable'}</td></tr>)}</tbody></table></div></Section></TabsContent> : null}
              </div>
            </Tabs>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
    <StemDetailModal stemId={selectedStemId} open={Boolean(selectedStemId)} onClose={() => setSelectedStemId(null)} onUpdated={() => load({ force: true, section: activeTab })} />
    </>
  );
}
