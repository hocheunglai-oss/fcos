import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BuyerPaymentAnalysis from '@/components/dashboard/BuyerPaymentAnalysis';
import DashboardFilterBar from '@/components/dashboard/DashboardFilterBar';
import DashboardKpis from '@/components/dashboard/DashboardKpis';
import DashboardStemTable from '@/components/dashboard/DashboardStemTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import DataStatus from '@/components/common/DataStatus';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import PaymentDataReliabilityBadge from '@/components/common/PaymentDataReliabilityBadge';
import { DASHBOARD_METHODOLOGY } from '@/lib/pageMethodologyIndex';
import { DASHBOARD_FILTER_STORAGE_KEY, dashboardFilterKey, getRecentYears, normalizeDashboardFilters, presetDashboardPeriod } from '@/lib/dashboardFilters';
import { useDashboardResource } from '@/hooks/useDashboardResource';

const DashboardAnalytics = lazy(() => import('@/components/dashboard/DashboardAnalytics'));
const AccountCreditDirectory = lazy(() => import('@/components/dashboard/AccountCreditDirectory'));
const AccountInsightModal = lazy(() => import('@/components/dashboard/AccountInsightModal'));
const STEM_PAGE_SIZE = 50;
const DEFAULT_STEM_SORT = Object.freeze({ field: 'createdDate', direction: 'desc' });
const FIRST_STEM_PAGE = { cursor: null, history: [], sort: DEFAULT_STEM_SORT };
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const INSIGHT_QUERY_KEYS = [
  'insightAccountId', 'insightName', 'insightRole', 'insightRoles', 'insightEntityType', 'insightTab', 'insightStatementSide',
  'insightPeriod', 'insightScope', 'insightYears', 'insightMonths', 'insightDisputeOnly', 'insightAccountIds',
  'insightSupplierIds', 'insightPortIds', 'insightCountryCodes', 'insightExcludedCountryCodes', 'insightKoreaDeskMode',
  'insightCompany', 'insightGroup', 'insightPort', 'insightCountry',
];
const splitQueryList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const hongKongCalendarDate = (date = new Date()) => new Date(date.getTime() + HONG_KONG_OFFSET_MS).toISOString().slice(0, 10);
const millisecondsUntilNextHongKongDate = (date = new Date()) => {
  const shifted = new Date(date.getTime() + HONG_KONG_OFFSET_MS);
  const nextMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return Math.max(1_000, nextMidnight - shifted.getTime() + 1_000);
};

function readSavedFilters() { try { return normalizeDashboardFilters(JSON.parse(localStorage.getItem(DASHBOARD_FILTER_STORAGE_KEY) || '{}')); } catch { return normalizeDashboardFilters({ ...presetDashboardPeriod('year_to_date'), datePreset: 'year_to_date' }); } }
function normaliseOptions(data) { return Array.isArray(data?.options) ? data.options.map((option) => typeof option === 'string' ? { label: option, value: option } : option).filter(Boolean) : []; }
function ErrorBlock({ message, onRetry }) { return <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"><span className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}</span>{onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}</div>; }

export default function DashboardSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(readSavedFilters);
  const [tab, setTab] = useState(() => ['overview', 'stems', 'accounts'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview');
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [portOptions, setPortOptions] = useState([]);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [stemSearch, setStemSearch] = useState('');
  const [navigation, setNavigation] = useState(FIRST_STEM_PAGE);
  const [stemTableWide, setStemTableWide] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(null);
  const [ebitEnabled, setEbitEnabled] = useState(false);
  const [financeRevision, setFinanceRevision] = useState(0);
  const dashboardRootRef = useRef(null);
  const insightScrollContainerRef = useRef(null);
  const insightTriggerRef = useRef(null);
  const insightScrollRef = useRef(null);
  const insightWasOpenRef = useRef(false);
  const filterKey = useMemo(() => dashboardFilterKey(filters), [filters]);
  const filterPayload = useMemo(() => JSON.parse(filterKey), [filterKey]);

  const stemKey = JSON.stringify([filterKey, stemSearch, navigation.cursor, navigation.sort]);
  const { snapshot: summarySnapshot, loading: summaryLoading, error: summaryError, load: requestSummary, clear: clearSummary } = useDashboardResource(ebitEnabled ? `${filterKey}:ebit` : filterKey);
  const { snapshot: stemSnapshot, loading: ordinaryStemLoading, error: ordinaryStemError, load: requestStems, clear: clearStems } = useDashboardResource(stemKey);
  const { snapshot: analyticsSnapshot, loading: analyticsLoading, error: analyticsError, load: requestAnalytics, clear: clearAnalytics } = useDashboardResource(filterKey);
  const { snapshot: aiSnapshot, loading: aiLoading, error: aiError, load: requestAi, clear: clearAi } = useDashboardResource(filterKey);
  const aiSearch = aiSnapshot?.data.aiSearch;
  const aiSearchActive = aiPrompt !== null;
  const aiReady = aiSearchActive && aiSearch?.status === 'ready';
  const aiFailure = aiSearchActive && (aiError || (aiSnapshot && !aiReady && (aiSearch?.clarification?.question || 'AI search needs a more specific request.')));
  const paymentAnalysis = aiReady ? aiSnapshot.data.paymentAnalysis : null;
  const summary = summarySnapshot?.data;
  const analytics = analyticsSnapshot?.data;
  const currentAnalytics = analyticsLoading || analyticsError ? null : analytics;
  const stems = aiSearchActive ? (aiReady ? aiSnapshot.data : null) : stemSnapshot?.data;
  const stemLoading = aiSearchActive ? aiLoading : ordinaryStemLoading;
  const stemError = aiSearchActive ? aiFailure : ordinaryStemError;
  const stemReady = Boolean(stems && !stemLoading && !stemError);
  const stemScope = aiSearchActive ? aiSnapshot : stemKey;
  const displayedStemId = stemReady && selectedStemId?.scope === stemScope ? selectedStemId.id : null;

  const exportScopeLabels = useMemo(() => ({
    counterparty: filters.counterparty?.name || filters.company || filters.group || 'All',
    port: filters.port || 'All',
    country: filters.country || 'All',
    koreaDesk: filters.koreaDeskMode === 'include' ? 'Korea Desk' : filters.koreaDeskMode === 'exclude' ? 'Exclude Korea Desk' : 'All',
  }), [filters.company, filters.counterparty?.name, filters.country, filters.datePreset, filters.group, filters.koreaDeskMode, filters.port]);
  const years = useMemo(() => getRecentYears(Math.max(new Date().getFullYear(), ...filters.selectedYears), 4), [filters.selectedYears]);
  const productVolumeKpi = useMemo(() => ({ unitOfMeasure: summary?.productVolume?.unitOfMeasure || 'MT', quantity: summary?.productVolume?.quantity ?? null, breakdown: summary?.productVolume?.breakdown || [] }), [summary?.productVolume?.breakdown, summary?.productVolume?.quantity, summary?.productVolume?.unitOfMeasure]);
  const productVolumeUnit = productVolumeKpi.unitOfMeasure;
  const monthlyVolumeAxisUnit = productVolumeKpi.unitOfMeasure;
  const dashboardKpiSummary = useMemo(() => summary ? {
    ...summary,
    productVolumeKpi,
    productVolumeUnit,
    monthlyVolumeAxisUnit,
    comparisonByCurrency: currentAnalytics?.comparisonByCurrency || summary.comparisonByCurrency,
    priorPeriod: currentAnalytics?.priorPeriod || summary.priorPeriod,
  } : summary, [currentAnalytics?.comparisonByCurrency, currentAnalytics?.priorPeriod, monthlyVolumeAxisUnit, productVolumeKpi, productVolumeUnit, summary]);
  const insightQuery = useMemo(() => {
    const accountId = searchParams.get('insightAccountId') || '';
    const role = ['buyer', 'supplier', 'group', 'both'].includes(searchParams.get('insightRole')) ? searchParams.get('insightRole') : 'buyer';
    const roles = splitQueryList(searchParams.get('insightRoles')).filter((item) => item === 'buyer' || item === 'supplier');
    const statementSide = ['both', 'buyer', 'supplier'].includes(searchParams.get('insightStatementSide')) ? searchParams.get('insightStatementSide') : undefined;
    const mode = searchParams.get('insightKoreaDeskMode');
    const geographicCodes = (key, legacyMode) => splitQueryList(searchParams.get(key))
      .filter((country) => mode !== legacyMode || country.toUpperCase() !== 'KOREA');
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
        countryCodes: geographicCodes('insightCountryCodes', 'include'),
        excludedCountryCodes: geographicCodes('insightExcludedCountryCodes', 'exclude'),
        koreaDeskMode: mode === 'include' || mode === 'exclude' ? mode : 'all',
      },
      labels: { company: searchParams.get('insightCompany') || '', group: searchParams.get('insightGroup') || '', port: searchParams.get('insightPort') || '', country: searchParams.get('insightCountry') || '', desk: mode === 'include' ? 'Korea Desk' : mode === 'exclude' ? 'Exclude Korea Desk' : '' },
    };
  }, [searchParams]);
  const insightDashboardScope = useMemo(() => ({ mode: insightQuery.scope, disputeOnly: insightQuery.disputeOnly, filters: insightQuery.filters, labels: insightQuery.labels }), [insightQuery.disputeOnly, insightQuery.filters, insightQuery.labels, insightQuery.scope]);

  useEffect(() => {
    const root = dashboardRootRef.current;
    const header = root?.querySelector('.app-page-header');
    if (!root || !header) return undefined;
    const measure = () => root.style.setProperty('--dashboard-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => { localStorage.setItem(DASHBOARD_FILTER_STORAGE_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => { let live = true; appClient.functions.invoke('dashboardFilterOptions', { optionType: 'ports' }, { cache: true, cacheTtlMs: 300_000 }).then((ports) => { if (live) setPortOptions(normaliseOptions(ports.data)); }); return () => { live = false; }; }, []);

  const loadSummary = useCallback((options) => requestSummary('dashboardSummary',
    ebitEnabled ? { ...filterPayload, includeFinanceCosts: true } : filterPayload, options
  ), [ebitEnabled, filterPayload, requestSummary]);
  const loadStems = useCallback((options) => requestStems('dashboardStemList', {
    ...filterPayload, cursor: navigation.cursor, pageSize: STEM_PAGE_SIZE, sort: navigation.sort, search: stemSearch || null,
  }, options), [filterPayload, navigation.cursor, navigation.sort, requestStems, stemSearch]);
  const loadAnalytics = useCallback(({ force = false } = {}) => requestAnalytics('dashboardAnalytics', filterPayload, {
    force, once: true,
  }), [filterPayload, requestAnalytics]);
  const refreshFinanceSummary = useCallback(() => {
    setFinanceRevision((revision) => revision + 1);
    void loadSummary({ force: true, retain: false });
  }, [loadSummary]);
  const runAiSearch = useCallback(async (prompt, { force = false } = {}) => {
    clearStems();
    setSelectedStemId(null);
    setAiPrompt(prompt);
    setStemSearch('');
    setNavigation(FIRST_STEM_PAGE);
    const snapshot = await requestAi('dashboardAiSearch', {
      prompt, selectedYears: filters.selectedYears, selectedMonths: filters.selectedMonths, filterSpec: filterPayload,
    }, { force, retain: false });
    if (snapshot?.data.aiSearch?.status === 'ready') setTab('stems');
  }, [clearStems, filterPayload, filters.selectedMonths, filters.selectedYears, requestAi]);

  useEffect(() => {
    const timer = window.setTimeout(loadSummary, 220);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);
  useEffect(() => {
    if (aiSearchActive) return undefined;
    const timer = window.setTimeout(loadStems, 220);
    return () => window.clearTimeout(timer);
  }, [aiSearchActive, loadStems]);
  useEffect(() => {
    if (!ebitEnabled) return undefined;
    const refreshIfDateChanged = () => {
      if (document.visibilityState !== 'visible') return;
      const asOfDate = summary?.finance?.asOfDate;
      if (asOfDate && asOfDate !== hongKongCalendarDate()) refreshFinanceSummary();
    };
    const onFinanceSettingsUpdated = () => refreshFinanceSummary();
    window.addEventListener('fcos:finance-settings-updated', onFinanceSettingsUpdated);
    document.addEventListener('visibilitychange', refreshIfDateChanged);
    const dateBoundaryTimer = window.setTimeout(refreshIfDateChanged, millisecondsUntilNextHongKongDate());
    return () => {
      window.removeEventListener('fcos:finance-settings-updated', onFinanceSettingsUpdated);
      document.removeEventListener('visibilitychange', refreshIfDateChanged);
      window.clearTimeout(dateBoundaryTimer);
    };
  }, [ebitEnabled, refreshFinanceSummary, summary?.finance?.asOfDate]);
  useEffect(() => { if (summary && !analyticsEnabled) setAnalyticsEnabled(true); }, [analyticsEnabled, summary]);
  useEffect(() => {
    const open = Boolean(insightQuery.accountId);
    if (insightWasOpenRef.current && !open) {
      const scrollTop = insightScrollRef.current;
      const trigger = insightTriggerRef.current;
      window.requestAnimationFrame(() => {
        if (Number.isFinite(scrollTop)) {
          if (insightScrollContainerRef.current?.isConnected) insightScrollContainerRef.current.scrollTop = scrollTop;
          else window.scrollTo({ top: scrollTop, left: 0, behavior: 'auto' });
        }
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    }
    insightWasOpenRef.current = open;
  }, [insightQuery.accountId]);
  const changeFilters = (next) => {
    const merged = normalizeDashboardFilters(next);
    if (merged.datePreset !== filters.datePreset && merged.datePreset !== 'custom') Object.assign(merged, presetDashboardPeriod(merged.datePreset));
    if (dashboardFilterKey(merged) !== filterKey) {
      clearSummary();
      clearAnalytics();
      clearStems();
      clearAi();
      setAiPrompt(null);
      setNavigation(FIRST_STEM_PAGE);
      setSelectedStemId(null);
      if (insightQuery.accountId) {
        const params = new URLSearchParams(searchParams);
        INSIGHT_QUERY_KEYS.forEach((key) => params.delete(key));
        setSearchParams(params, { replace: true });
      }
    }
    setFilters(merged);
  };
  const changeEbit = (enabled) => {
    clearSummary();
    setEbitEnabled(enabled === true);
  };
  const changeStemSelection = ({ search = stemSearch, page = FIRST_STEM_PAGE } = {}) => {
    if (!aiSearchActive && search === stemSearch && page === navigation) return;
    clearAi();
    clearStems();
    setAiPrompt(null);
    setSelectedStemId(null);
    setStemSearch(search);
    setNavigation(page);
  };
  const openAccount = useCallback((account, initialTab = 'overview', trigger = null) => {
    if (!account?.accountId) return;
    insightTriggerRef.current = trigger || document.activeElement;
    insightScrollContainerRef.current = dashboardRootRef.current?.closest('.app-workspace-scroll') || null;
    insightScrollRef.current = insightScrollContainerRef.current?.scrollTop ?? window.scrollY;
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
      ['insightExcludedCountryCodes', filterPayload.filters.excludedCountryCodes],
    ];
    queryValues.forEach(([key, values]) => { if (values.length) next.set(key, values.join(',')); else next.delete(key); });
    if (filters.koreaDeskMode !== 'all') next.set('insightKoreaDeskMode', filters.koreaDeskMode); else next.delete('insightKoreaDeskMode');
    const labels = { insightCompany: filters.counterparty?.entityType === 'account' ? filters.counterparty.name : filters.company, insightGroup: filters.counterparty?.entityType === 'group' ? filters.counterparty.name : filters.group, insightPort: filters.port, insightCountry: filters.country };
    Object.entries(labels).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    navigate({ pathname: '/', search: `?${next.toString()}` }, { state: { ...location.state, dashboardInsightOverlay: true } });
  }, [filterPayload.filters.accountIds, filterPayload.filters.countryCodes, filterPayload.filters.excludedCountryCodes, filterPayload.filters.portIds, filterPayload.filters.supplierIds, filters.company, filters.counterparty?.entityType, filters.counterparty?.name, filters.country, filters.disputeOnly, filters.group, filters.koreaDeskMode, filters.port, filters.selectedMonths, filters.selectedYears, location.state, navigate, searchParams]);
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
  const refresh = () => {
    setSelectedStemId(null);
    if (ebitEnabled) refreshFinanceSummary();
    else void loadSummary({ force: true });
    if (aiSearchActive) changeStemSelection({ search: '' });
    else void loadStems({ force: true });
    if ((tab === 'overview' && analyticsEnabled) || tab === 'accounts') void loadAnalytics({ force: true });
  };

  return <main ref={dashboardRootRef} className={`workspace-page workspace-dashboard mx-auto p-3 transition-[max-width] duration-200 sm:p-6 lg:p-8 ${stemTableWide && tab === 'stems' ? 'workspace-page-wide max-w-none' : 'max-w-[1600px]'}`}><PageHeader inlineMeta icon={Building2} title="Dashboard" meta={<span className="flex flex-wrap items-center gap-2"><DataStatus meta={summarySnapshot?.meta} label="Data" state={summaryError ? (summary ? 'stale_error' : 'unavailable') : summaryLoading ? 'refreshing' : undefined} /><PaymentDataReliabilityBadge /></span>} actions={<><PageMethodology {...DASHBOARD_METHODOLOGY} /><Button type="button" size="sm" variant="outline" onClick={refresh} disabled={summaryLoading || stemLoading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${summaryLoading || stemLoading ? 'animate-spin' : ''}`} />Refresh</Button></>} />
    <DashboardFilterBar showPerspective={tab !== 'accounts'} filters={filters} years={years} portOptions={portOptions} loading={summaryLoading || stemLoading} onChange={changeFilters} onReset={() => changeFilters(normalizeDashboardFilters({ ...presetDashboardPeriod('year_to_date'), datePreset: 'year_to_date' }))} onAiSearch={runAiSearch} />
    {summaryError ? <ErrorBlock message={summaryError} onRetry={() => loadSummary({ force: true })} /> : null}
    {tab !== 'stems' && aiFailure ? <ErrorBlock message={aiFailure} onRetry={() => runAiSearch(aiPrompt, { force: true })} /> : null}
    <Tabs value={tab} onValueChange={(nextTab) => { setTab(nextTab); const next = new URLSearchParams(searchParams); if (nextTab === 'overview') next.delete('tab'); else next.set('tab', nextTab); setSearchParams(next, { replace: true }); }}>
      <TabsList className="mb-4 w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="stems">STEMs</TabsTrigger><TabsTrigger value="accounts">Accounts</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-4">
        {!summary && summaryLoading && !ebitEnabled ? <div className="dashboard-primary-kpis" role="status" aria-label="Loading Dashboard figures">{[1, 2, 3, 4].map((key) => <div key={key} className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />)}</div> : <DashboardKpis summary={dashboardKpiSummary} ebitEnabled={ebitEnabled} onEbitChange={changeEbit} financeLoading={ebitEnabled && summaryLoading} financeError={ebitEnabled ? summaryError : null} />}
        {analyticsEnabled ? <Suspense fallback={<div className="h-56 animate-pulse rounded-xl border border-border bg-card" />}>
          <DashboardAnalytics data={analytics} meta={analyticsSnapshot?.meta} loading={analyticsLoading} error={analyticsError} onLoad={loadAnalytics} counterpartyMode={filters.counterpartyMode} onAccountClick={(account) => openAccount(account, 'overview')} />
        </Suspense> : <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Analytics</h2><p className="mt-1 text-xs text-muted-foreground">Load trends and rankings only when you need a deeper view.</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setAnalyticsEnabled(true)}>Load analytics</Button></section>}
      </TabsContent>
      <TabsContent value="stems" className="space-y-4">
        {stemError ? <ErrorBlock message={stemError} onRetry={() => aiSearchActive ? runAiSearch(aiPrompt, { force: true }) : loadStems({ force: true })} /> : null}
        {paymentAnalysis ? <BuyerPaymentAnalysis result={paymentAnalysis} periodLabel={aiSearch.dateScope?.label} onAccountClick={(account) => openAccount(account, 'payments')} /> : <DashboardStemTable
          result={aiReady ? { stems: stems.recentStems || stems.stems, matchingCount: aiSearch.matchedCount, pageSize: (stems.recentStems || stems.stems || []).length, aiSearch } : stems}
          loading={stemLoading} error={stemError} meta={aiSearchActive ? aiSnapshot?.meta : stemSnapshot?.meta}
          page={navigation.history.length + 1} hasPrevious={navigation.history.length > 0}
          search={stemSearch} wide={stemTableWide} onWideChange={setStemTableWide}
          exportFilterPayload={filterPayload} exportScopeLabels={exportScopeLabels} includeFinanceCosts={ebitEnabled}
          exportScope={JSON.stringify([stemKey, financeRevision])} exportReady={!ebitEnabled || Boolean(summary && !summaryLoading && !summaryError)}
          aiSearchActive={aiSearchActive} onClearAiSearch={() => changeStemSelection({ search: '' })}
          onSearch={(search) => { if (aiSearchActive || search !== stemSearch) changeStemSelection({ search }); }}
          onPrevious={() => changeStemSelection({ page: { ...navigation, cursor: navigation.history.at(-1) ?? null, history: navigation.history.slice(0, -1) } })}
          onNext={() => changeStemSelection({ page: { ...navigation, cursor: stems.nextCursor ?? stems.pagination?.nextCursor, history: [...navigation.history, navigation.cursor] } })}
          onSortChange={(sort) => changeStemSelection({ page: { ...FIRST_STEM_PAGE, sort } })}
          onStemClick={(row) => setSelectedStemId({ id: row.Id ?? row.id, scope: stemScope })}
          onAccountClick={(account) => openAccount(account, 'overview')}
        />}
      </TabsContent>
      <TabsContent value="accounts" className="space-y-5"><Suspense fallback={<div className="h-48 animate-pulse rounded-xl border border-border bg-card" />}><AccountCreditDirectory counterparty={filterPayload.counterparty} dateWindows={filterPayload.dateWindows} disputeOnly={filterPayload.disputeOnly} filters={filterPayload.filters} onOpen={openAccount} /></Suspense></TabsContent>
    </Tabs>
    {displayedStemId ? <StemDetailModal stemId={displayedStemId} open onClose={() => setSelectedStemId(null)} /> : null}
    {insightQuery.account ? <Suspense fallback={null}><AccountInsightModal account={insightQuery.account} open onClose={closeAccountInsight} selectedYears={insightQuery.years.length ? insightQuery.years : filters.selectedYears} selectedMonths={insightQuery.months.length ? insightQuery.months : filters.selectedMonths} dashboardScope={insightDashboardScope} initialPeriodMode={insightQuery.period} onViewChange={updateAccountInsightView} /></Suspense> : null}</main>;
}
