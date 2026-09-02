import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DashboardFilterBar from '@/components/dashboard/DashboardFilterBar';
import DashboardKpis from '@/components/dashboard/DashboardKpis';
import DashboardSavedViews from '@/components/dashboard/DashboardSavedViews';
import DashboardStemTable from '@/components/dashboard/DashboardStemTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import DataStatus from '@/components/common/DataStatus';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import PaymentDataReliabilityBadge from '@/components/common/PaymentDataReliabilityBadge';
import { DASHBOARD_METHODOLOGY } from '@/lib/pageMethodologies';
import { DASHBOARD_FILTER_STORAGE_KEY, dashboardFilterKey, dashboardFilterPayload, getRecentYears, normalizeDashboardFilters, presetDashboardPeriod } from '@/lib/dashboardFilters';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';

const DashboardAnalytics = lazy(() => import('@/components/dashboard/DashboardAnalytics'));
const AccountCreditDirectory = lazy(() => import('@/components/dashboard/AccountCreditDirectory'));
const AccountInsightModal = lazy(() => import('@/components/dashboard/AccountInsightModal'));
const STEM_PAGE_SIZE = 50;
const DEFAULT_STEM_SORT = Object.freeze({ field: 'createdDate', direction: 'desc' });
const INSIGHT_QUERY_KEYS = [
  'insightAccountId', 'insightName', 'insightRole', 'insightRoles', 'insightEntityType', 'insightTab', 'insightStatementSide',
  'insightPeriod', 'insightScope', 'insightYears', 'insightMonths', 'insightDisputeOnly', 'insightAccountIds',
  'insightSupplierIds', 'insightPortIds', 'insightCountryCodes', 'insightCompany', 'insightGroup', 'insightPort', 'insightCountry',
];
const splitQueryList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

function readSavedFilters() { try { return normalizeDashboardFilters(JSON.parse(localStorage.getItem(DASHBOARD_FILTER_STORAGE_KEY) || '{}')); } catch { return normalizeDashboardFilters({ ...presetDashboardPeriod('year_to_date'), datePreset: 'year_to_date' }); } }
function normaliseOptions(data) { return Array.isArray(data?.options) ? data.options.map((option) => typeof option === 'string' ? { label: option, value: option } : option).filter(Boolean) : []; }
function ErrorBlock({ message, onRetry }) { return <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"><span className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}</span>{onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}</div>; }

export default function DashboardSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(readSavedFilters);
  const [tab, setTab] = useState(() => ['overview', 'stems', 'accounts'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview');
  const [summary, setSummary] = useState(null);
  const [stems, setStems] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [navigation, setNavigation] = useState({ cursor: null, history: [], sort: DEFAULT_STEM_SORT });
  const [loading, setLoading] = useState({ summary: false, stems: false, analytics: false });
  const [errors, setErrors] = useState({});
  const [portOptions, setPortOptions] = useState([]);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [stemSearch, setStemSearch] = useState('');
  const [stemTableWide, setStemTableWide] = useState(false);
  const [aiSearchActive, setAiSearchActive] = useState(false);
  const aborts = useRef({});
  const insightTriggerRef = useRef(null);
  const insightScrollRef = useRef(null);
  const insightWasOpenRef = useRef(false);
  const skipNextAutoLoadRef = useRef(false);
  const { cancelPendingUpdates } = useNavigationAwareRequest('operational');
  const filterPayload = useMemo(() => dashboardFilterPayload(filters), [filters]);
  const filterKey = useMemo(() => dashboardFilterKey(filters), [filters]);
  const years = useMemo(() => getRecentYears(Math.max(new Date().getFullYear(), ...filters.selectedYears), 4), [filters.selectedYears]);
  const productVolumeKpi = useMemo(() => ({ unitOfMeasure: summary?.productVolume?.unitOfMeasure || 'MT', quantity: summary?.productVolume?.quantity ?? null, breakdown: summary?.productVolume?.breakdown || [] }), [summary?.productVolume?.breakdown, summary?.productVolume?.quantity, summary?.productVolume?.unitOfMeasure]);
  const productVolumeUnit = productVolumeKpi.unitOfMeasure;
  const monthlyVolumeAxisUnit = productVolumeKpi.unitOfMeasure;
  const dashboardKpiSummary = useMemo(() => summary ? {
    ...summary,
    productVolumeKpi,
    productVolumeUnit,
    monthlyVolumeAxisUnit,
    comparisonByCurrency: analytics?.comparisonByCurrency || summary.comparisonByCurrency,
    priorPeriod: analytics?.priorPeriod || summary.priorPeriod,
  } : summary, [analytics?.comparisonByCurrency, analytics?.priorPeriod, monthlyVolumeAxisUnit, productVolumeKpi, productVolumeUnit, summary]);
  const insightQuery = useMemo(() => {
    const accountId = searchParams.get('insightAccountId') || '';
    const role = ['buyer', 'supplier', 'group', 'both'].includes(searchParams.get('insightRole')) ? searchParams.get('insightRole') : 'buyer';
    const roles = splitQueryList(searchParams.get('insightRoles')).filter((item) => item === 'buyer' || item === 'supplier');
    const statementSide = ['both', 'buyer', 'supplier'].includes(searchParams.get('insightStatementSide')) ? searchParams.get('insightStatementSide') : undefined;
    return {
      accountId,
      account: accountId ? { accountId, name: searchParams.get('insightName') || 'Account', role, roles, statementSide, entityType: searchParams.get('insightEntityType') === 'group' ? 'group' : 'account', initialTab: ['overview', 'trading', 'payments', 'risk', 'stems', 'credit', 'children'].includes(searchParams.get('insightTab')) ? searchParams.get('insightTab') : 'overview' } : null,
      period: searchParams.get('insightPeriod') || 'dashboard_period',
      scope: searchParams.get('insightScope') === 'account_wide' ? 'account_wide' : 'dashboard',
      years: splitQueryList(searchParams.get('insightYears')).map(Number).filter(Number.isInteger),
      months: splitQueryList(searchParams.get('insightMonths')).map(Number).filter(Number.isInteger),
      disputeOnly: searchParams.get('insightDisputeOnly') === '1',
      filters: {
        accountIds: splitQueryList(searchParams.get('insightAccountIds')),
        supplierIds: splitQueryList(searchParams.get('insightSupplierIds')),
        portIds: splitQueryList(searchParams.get('insightPortIds')),
        countryCodes: splitQueryList(searchParams.get('insightCountryCodes')),
      },
      labels: { company: searchParams.get('insightCompany') || '', group: searchParams.get('insightGroup') || '', port: searchParams.get('insightPort') || '', country: searchParams.get('insightCountry') || '' },
    };
  }, [searchParams]);
  const insightDashboardScope = useMemo(() => ({ mode: insightQuery.scope, disputeOnly: insightQuery.disputeOnly, filters: insightQuery.filters, labels: insightQuery.labels }), [insightQuery.disputeOnly, insightQuery.filters, insightQuery.labels, insightQuery.scope]);

  useEffect(() => { localStorage.setItem(DASHBOARD_FILTER_STORAGE_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => { let live = true; appClient.functions.invoke('dashboardFilterOptions', { optionType: 'ports' }, { cache: true, cacheTtlMs: 300_000 }).then((ports) => { if (live) setPortOptions(normaliseOptions(ports.data)); }); return () => { live = false; }; }, []);

  const invoke = useCallback(async (key, handler, payload, { force = false } = {}) => {
    aborts.current[key]?.abort();
    const controller = new AbortController();
    aborts.current[key] = controller;
    const result = await appClient.functions.invoke(handler, payload, { cache: true, cacheTtlMs: 30_000, signal: controller.signal, cacheTags: ['dashboard'], force });
    if (controller.signal.aborted) return { result: null, controller };
    if (result.data?.error) throw new Error(result.data.error);
    return { result, controller };
  }, []);

  const loadSummary = useCallback(async ({ force = false } = {}) => { setLoading((value) => ({ ...value, summary: true })); setErrors((value) => ({ ...value, summary: null })); let request; try { request = await invoke('summary', 'dashboardSummary', filterPayload, { force }); if (request.result) { setSummary(request.result.data); setSummaryMeta(request.result.meta); } } catch (error) { if (error.name !== 'AbortError') setErrors((value) => ({ ...value, summary: error.message || 'Dashboard summary could not be loaded.' })); } finally { if (!request || aborts.current.summary === request.controller) setLoading((value) => ({ ...value, summary: false })); } }, [filterPayload, invoke]);
  const loadStems = useCallback(async ({ cursor = null, history = [], sort = DEFAULT_STEM_SORT, search = stemSearch, force = false } = {}) => { setLoading((value) => ({ ...value, stems: true })); setErrors((value) => ({ ...value, stems: null })); let request; try { request = await invoke('stems', 'dashboardStemList', { ...filterPayload, cursor, pageSize: STEM_PAGE_SIZE, sort, search: search || null }, { force }); if (request.result) { setStems({ ...request.result.data, page: history.length + 1, previousCursor: history.at(-1) ?? null }); setNavigation({ cursor, history, sort: request.result.data.sort || sort }); } } catch (error) { if (error.name !== 'AbortError') setErrors((value) => ({ ...value, stems: error.message || 'STEMs could not be loaded.' })); } finally { if (!request || aborts.current.stems === request.controller) setLoading((value) => ({ ...value, stems: false })); } }, [filterPayload, invoke, stemSearch]);
  const loadAnalytics = useCallback(async ({ force = false } = {}) => { if (!force && (analytics?.filterKey === filterKey || loading.analytics)) return; setLoading((value) => ({ ...value, analytics: true })); setErrors((value) => ({ ...value, analytics: null })); let request; try { request = await invoke('analytics', 'dashboardAnalytics', filterPayload, { force }); if (request.result) setAnalytics({ ...request.result.data, filterKey }); } catch (error) { if (error.name !== 'AbortError') setErrors((value) => ({ ...value, analytics: error.message || 'Analytics could not be loaded.' })); } finally { if (!request || aborts.current.analytics === request.controller) setLoading((value) => ({ ...value, analytics: false })); } }, [analytics?.filterKey, filterKey, filterPayload, invoke, loading.analytics]);
  const runAiSearch = useCallback(async (prompt) => { setErrors((value) => ({ ...value, ai: null })); try { const request = await invoke('ai', 'dashboardAiSearch', { prompt, selectedYears: filters.selectedYears, selectedMonths: filters.selectedMonths, filterSpec: filterPayload }); const aiSearch = request.result?.data?.aiSearch; if (aiSearch?.status !== 'ready') { setErrors((value) => ({ ...value, ai: aiSearch?.clarification?.question || 'AI search needs a more specific request.' })); return; } const rows = request.result.data.recentStems || request.result.data.stems || []; setAiSearchActive(true); setStemSearch(''); setStems({ stems: rows, matchingCount: aiSearch.matchedCount, page: 1, pageSize: rows.length, nextCursor: null, aiSearch }); setNavigation((value) => ({ ...value, cursor: null, history: [] })); setTab('stems'); } catch (error) { if (error.name !== 'AbortError') setErrors((value) => ({ ...value, ai: error.message || 'AI search is unavailable.' })); } }, [filterPayload, filters.selectedMonths, filters.selectedYears, invoke]);

  useEffect(() => { if (aiSearchActive) return undefined; if (skipNextAutoLoadRef.current) { skipNextAutoLoadRef.current = false; return undefined; } const timer = window.setTimeout(() => { loadSummary(); loadStems({ cursor: null, history: [], sort: DEFAULT_STEM_SORT }); }, 220); return () => window.clearTimeout(timer); }, [aiSearchActive, filterKey, loadSummary, loadStems]);
  useEffect(() => { if (summary && !analyticsEnabled) setAnalyticsEnabled(true); }, [analyticsEnabled, summary]);
  useEffect(() => () => { Object.values(aborts.current).forEach((controller) => controller?.abort()); }, []);
  useEffect(() => {
    const open = Boolean(insightQuery.accountId);
    if (insightWasOpenRef.current && !open) {
      const scrollTop = insightScrollRef.current;
      const trigger = insightTriggerRef.current;
      window.requestAnimationFrame(() => {
        if (Number.isFinite(scrollTop)) window.scrollTo({ top: scrollTop, left: 0, behavior: 'auto' });
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    }
    insightWasOpenRef.current = open;
  }, [insightQuery.accountId]);
  const changeFilters = (next) => { cancelPendingUpdates(); Object.values(aborts.current).forEach((controller) => controller?.abort()); const merged = normalizeDashboardFilters(next); if (merged.datePreset !== filters.datePreset && merged.datePreset !== 'custom') Object.assign(merged, presetDashboardPeriod(merged.datePreset)); setAiSearchActive(false); setFilters(merged); };
  const openAccount = useCallback((account, initialTab = 'overview', trigger = null) => {
    if (!account?.accountId) return;
    insightTriggerRef.current = trigger || document.activeElement;
    insightScrollRef.current = window.scrollY;
    const next = new URLSearchParams(searchParams);
    next.set('insightAccountId', account.accountId);
    next.set('insightName', account.name || 'Account');
    next.set('insightRole', account.role || 'both');
    next.set('insightRoles', (account.roles || (account.role === 'both' ? ['buyer', 'supplier'] : [account.role])).filter((role) => role === 'buyer' || role === 'supplier').join(','));
    next.set('insightEntityType', account.entityType || 'account');
    next.set('insightTab', initialTab);
    next.set('insightStatementSide', initialTab === 'credit' && ['both', 'buyer', 'supplier'].includes(account.role) ? account.role : account.role === 'supplier' ? 'supplier' : 'buyer');
    next.set('insightPeriod', 'dashboard_period');
    next.set('insightScope', 'dashboard');
    next.set('insightYears', filters.selectedYears.join(','));
    next.set('insightMonths', filters.selectedMonths.join(','));
    if (filters.disputeOnly) next.set('insightDisputeOnly', '1'); else next.delete('insightDisputeOnly');
    const queryValues = [
      ['insightAccountIds', filterPayload.filters.accountIds], ['insightSupplierIds', filterPayload.filters.supplierIds],
      ['insightPortIds', filterPayload.filters.portIds], ['insightCountryCodes', filterPayload.filters.countryCodes],
    ];
    queryValues.forEach(([key, values]) => { if (values.length) next.set(key, values.join(',')); else next.delete(key); });
    const labels = { insightCompany: filters.counterparty?.entityType === 'account' ? filters.counterparty.name : filters.company, insightGroup: filters.counterparty?.entityType === 'group' ? filters.counterparty.name : filters.group, insightPort: filters.port, insightCountry: filters.country };
    Object.entries(labels).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    navigate({ pathname: '/', search: `?${next.toString()}` }, { state: { ...location.state, dashboardInsightOverlay: true } });
  }, [filterPayload.filters.accountIds, filterPayload.filters.countryCodes, filterPayload.filters.portIds, filterPayload.filters.supplierIds, filters.company, filters.counterparty?.entityType, filters.counterparty?.name, filters.country, filters.disputeOnly, filters.group, filters.port, filters.selectedMonths, filters.selectedYears, location.state, navigate, searchParams]);
  const updateAccountInsightView = useCallback(({ role, statementSide, tab: insightTab, periodMode, accountWide }) => {
    const next = new URLSearchParams(searchParams);
    if (role) next.set('insightRole', role);
    if (statementSide) next.set('insightStatementSide', statementSide);
    if (insightTab) next.set('insightTab', insightTab);
    if (periodMode) next.set('insightPeriod', periodMode);
    next.set('insightScope', accountWide ? 'account_wide' : 'dashboard');
    navigate({ pathname: '/', search: `?${next.toString()}` }, { replace: true, state: location.state });
  }, [location.state, navigate, searchParams]);
  const closeAccountInsight = useCallback(() => {
    if (location.state?.dashboardInsightOverlay) { navigate(-1); return; }
    const next = new URLSearchParams(searchParams);
    INSIGHT_QUERY_KEYS.forEach((key) => next.delete(key));
    next.set('tab', 'accounts');
    navigate({ pathname: '/', search: `?${next.toString()}` }, { replace: true, state: null });
  }, [location.state, navigate, searchParams]);
  const refresh = () => { if (aiSearchActive) skipNextAutoLoadRef.current = true; setAiSearchActive(false); loadSummary({ force: true }); loadStems({ cursor: aiSearchActive ? null : navigation.cursor, history: aiSearchActive ? [] : navigation.history, sort: aiSearchActive ? DEFAULT_STEM_SORT : navigation.sort, force: true }); if ((tab === 'overview' && analyticsEnabled) || tab === 'accounts') loadAnalytics({ force: true }); };

  return <main className={`workspace-page workspace-dashboard mx-auto p-3 transition-[max-width] duration-200 sm:p-6 lg:p-8 ${stemTableWide && tab === 'stems' ? 'workspace-page-wide max-w-none' : 'max-w-[1600px]'}`}><PageHeader icon={Building2} title="Dashboard" meta={<span className="flex flex-wrap items-center gap-2">{summaryMeta ? <DataStatus meta={summaryMeta} label="Salesforce" /> : <span>Loading current decision data</span>}<PaymentDataReliabilityBadge />{loading.summary && summary ? <span className="text-xs text-muted-foreground">Updating without clearing results…</span> : null}</span>} actions={<><PageMethodology {...DASHBOARD_METHODOLOGY} /><Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading.summary || loading.stems}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading.summary || loading.stems ? 'animate-spin' : ''}`} />Refresh</Button></>} />
    <DashboardSavedViews filters={filters} onApply={changeFilters} />
    <DashboardFilterBar filters={filters} years={years} portOptions={portOptions} loading={loading.summary || loading.stems} onChange={changeFilters} onReset={() => changeFilters(normalizeDashboardFilters({ ...presetDashboardPeriod('year_to_date'), datePreset: 'year_to_date' }))} onAiSearch={runAiSearch} />
    {errors.summary ? <ErrorBlock message={errors.summary} onRetry={loadSummary} /> : null}{errors.ai ? <ErrorBlock message={errors.ai} /> : null}<Tabs value={tab} onValueChange={(nextTab) => { setTab(nextTab); const next = new URLSearchParams(searchParams); if (nextTab === 'overview') next.delete('tab'); else next.set('tab', nextTab); setSearchParams(next, { replace: true }); }}><TabsList className="mb-4 w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="stems">STEMs</TabsTrigger><TabsTrigger value="accounts">Accounts</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-4"><DashboardKpis summary={dashboardKpiSummary} />{!summary && loading.summary ? <div className="grid gap-3 md:grid-cols-3">{[1, 2, 3].map((key) => <div key={key} className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />)}</div> : null}{analyticsEnabled ? <Suspense fallback={<div className="h-56 animate-pulse rounded-xl border border-border bg-card" />}><DashboardAnalytics data={analytics} loading={loading.analytics} error={errors.analytics} onLoad={loadAnalytics} counterpartyMode={filters.counterpartyMode} onAccountClick={(account) => openAccount(account, 'overview')} /></Suspense> : <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Analytics</h2><p className="mt-1 text-xs text-muted-foreground">Load trends and rankings only when you need a deeper view.</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setAnalyticsEnabled(true)}>Load analytics</Button></section>}</TabsContent>
      <TabsContent value="stems" className="space-y-4">{errors.stems ? <ErrorBlock message={errors.stems} onRetry={() => loadStems({ cursor: navigation.cursor, history: navigation.history, sort: navigation.sort })} /> : null}<DashboardStemTable result={stems} loading={loading.stems} search={stemSearch} wide={stemTableWide} onWideChange={setStemTableWide} onSearch={(value) => { setAiSearchActive(false); setStemSearch(value); }} onPrevious={() => loadStems({ cursor: navigation.history.at(-1) ?? null, history: navigation.history.slice(0, -1), sort: navigation.sort })} onNext={() => loadStems({ cursor: stems?.nextCursor ?? stems?.pagination?.nextCursor, history: [...navigation.history, navigation.cursor], sort: navigation.sort })} onSortChange={(sort) => { if (aiSearchActive) skipNextAutoLoadRef.current = true; setAiSearchActive(false); loadStems({ cursor: null, history: [], sort }); }} onStemClick={(row) => setSelectedStemId(row.Id ?? row.id)} onAccountClick={(account) => openAccount(account, 'overview')} /></TabsContent>
      <TabsContent value="accounts" className="space-y-5"><Suspense fallback={<div className="h-48 animate-pulse rounded-xl border border-border bg-card" />}><AccountCreditDirectory counterparty={filterPayload.counterparty} dateWindows={filterPayload.dateWindows} disputeOnly={filterPayload.disputeOnly} filters={filterPayload.filters} onOpen={openAccount} /></Suspense></TabsContent></Tabs>
    <StemDetailModal stemId={selectedStemId} open={Boolean(selectedStemId)} onClose={() => setSelectedStemId(null)} />
    {insightQuery.account ? <Suspense fallback={null}><AccountInsightModal account={insightQuery.account} open onClose={closeAccountInsight} selectedYears={insightQuery.years.length ? insightQuery.years : filters.selectedYears} selectedMonths={insightQuery.months.length ? insightQuery.months : filters.selectedMonths} dashboardScope={insightDashboardScope} initialPeriodMode={insightQuery.period} onViewChange={updateAccountInsightView} /></Suspense> : null}</main>;
}
