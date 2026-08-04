import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BarChart, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import PnlTable from '@/components/dashboard/PnlTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import DataStatus from '@/components/common/DataStatus';
import TableShell from '@/components/common/TableShell';
import { Package, Building2, DollarSign, AlertCircle, RefreshCw, SlidersHorizontal, Loader2, Search, X, Percent, Maximize2, Minimize2, Eye, EyeOff, Sparkles, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { MONTHS, THIS_MONTH, THIS_YEAR, buildDeliveryWhere, formatSelectedMonths, getRecentYears } from '@/lib/dashboardFilters';
import { DASHBOARD_METHODOLOGY } from '@/lib/pageMethodologies';

const STORAGE_KEY = 'dashboard_filters';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
const YEARS = getRecentYears();
const PRODUCT_FAMILY_KPI_ORDER = ['HSFO', 'VLSFO', 'LSMGO'];
const PRODUCT_VOLUME_COLORS = {
  HSFO: '#0f766e',
  VLSFO: '#2563eb',
  LSMGO: '#f59e0b',
};
const productFamilyRank = (family) => {
  const index = PRODUCT_FAMILY_KPI_ORDER.indexOf(String(family || '').toUpperCase());
  return index === -1 ? PRODUCT_FAMILY_KPI_ORDER.length : index;
};
const COUNTERPARTY_MODES = [
  { value: 'buyer', label: 'Buyer', plural: 'Buyers' },
  { value: 'supplier', label: 'Supplier', plural: 'Suppliers' },
];
const escapeSoqlLiteral = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const formatQuantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const AI_TABLE_PAGE_SIZE = 100;

export default function DashboardSettings() {
  const location = useLocation();
  const savedFilters = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
  const savedPortCountry = savedFilters.portCountry ?? (savedFilters.koreanPortOnly ? 'KOREA' : '');

  const [selectedYears, setSelectedYears] = useState(savedFilters.selectedYears ?? [THIS_YEAR]);
  const [selectedMonths, setSelectedMonths] = useState(savedFilters.selectedMonths ?? [THIS_MONTH]);
  const [disputeOnly, setDisputeOnly] = useState(savedFilters.disputeOnly ?? false);
  const [portCountry, setPortCountry] = useState(savedPortCountry);
  const [counterpartyMode, setCounterpartyMode] = useState(savedFilters.counterpartyMode === 'supplier' ? 'supplier' : 'buyer');
  const [monthlyTrendMode, setMonthlyTrendMode] = useState('profit');
  const [portCountryOptions, setPortCountryOptions] = useState([]);
  const [portCountrySuggestionsOpen, setPortCountrySuggestionsOpen] = useState(false);
  const [companyKeyword, setCompanyKeyword] = useState(savedFilters.companyKeyword ?? '');
  const [companyOptions, setCompanyOptions] = useState([]);
  const [companySuggestionsOpen, setCompanySuggestionsOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [responseMeta, setResponseMeta] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [filteredTableWide, setFilteredTableWide] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(savedFilters.showAnalytics === true);
  const debounceRef = useRef(null);
  const filteredStemsSectionRef = useRef(null);
  const [filteredTableHeight, setFilteredTableHeight] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiQuery, setAiQuery] = useState(null);
  const [aiSearch, setAiSearch] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiVisibleCount, setAiVisibleCount] = useState(AI_TABLE_PAGE_SIZE);

  const toggleYear = (yr) => setSelectedYears(prev =>
    prev.includes(yr) ? (prev.length > 1 ? prev.filter(y => y !== yr) : prev) : [...prev, yr]
  );

  const toggleMonth = (mo) => setSelectedMonths(prev =>
    prev.includes(mo) ? (prev.length > 1 ? prev.filter(m => m !== mo) : prev) : [...prev, mo]
  );

  const toggleAllMonths = () => setSelectedMonths(
    selectedMonths.length === 12 ? [THIS_MONTH] : MONTHS.map(m => m.value)
  );

  const updateCounterpartyMode = (mode) => {
    if (mode === counterpartyMode) return;
    setCounterpartyMode(mode);
    setCompanyKeyword('');
  };

  useEffect(() => {
    let cancelled = false;
    const loadPortCountries = async () => {
      const res = await appClient.functions.invoke('salesforceQuery', {
        soql: 'SELECT Name, Country__c FROM Port__c WHERE Country__c != null OR Name != null ORDER BY Country__c, Name LIMIT 2000'
      }, { cache: true });
      if (cancelled || res.data?.error) return;
      const options = [...new Set((res.data?.records || []).flatMap((row) => [
        row.Country__c,
        row.Name,
      ]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
      setPortCountryOptions(options);
    };
    loadPortCountries();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCompanies = async () => {
      setCompanyOptions([]);
      const isSupplier = counterpartyMode === 'supplier';
      const field = isSupplier ? 'Supplier_Name__c' : 'Buyer_Name__c';
      const soql = isSupplier
        ? `SELECT ${field}, COUNT(Id) total FROM STEM_Line_Item__c WHERE ${field} != null GROUP BY ${field} ORDER BY ${field} LIMIT 2000`
        : `SELECT Buyer_Name__c, Account__r.Group_Name__c, Account__r.Parent.Name FROM stem__c WHERE Buyer_Name__c != null ORDER BY Delivery_Date__c DESC NULLS LAST LIMIT 2000`;
      const res = await appClient.functions.invoke('salesforceQuery', {
        soql
      }, { cache: true });
      if (cancelled || res.data?.error) return;
      const names = isSupplier
        ? [...new Set((res.data?.records || []).map((row) => row[field]).filter(Boolean))]
        : [...new Set((res.data?.records || []).flatMap((row) => [
            row.Buyer_Name__c,
            row.Account__r?.Group_Name__c,
            row.Account__r?.Parent?.Name,
          ]).filter(Boolean))];
      setCompanyOptions(names.sort((a, b) => String(a).localeCompare(String(b))));
    };
    loadCompanies();
    return () => { cancelled = true; };
  }, [counterpartyMode]);

  const buildWhereClause = (yrs = selectedYears, mos = selectedMonths, country = portCountry) => {
    const normalizedCountry = String(country || '').trim();
    const portLike = normalizedCountry ? `%${escapeSoqlLiteral(normalizedCountry)}%` : '';
    const filters = [
      buildDeliveryWhere(yrs, mos),
      normalizedCountry ? `(Port__r.Country__c LIKE '${portLike}' OR Port__r.Name LIKE '${portLike}')` : '',
    ].filter(Boolean);
    return filters.map((condition) => `(${condition})`).join(' AND ');
  };

  const load = async (
    yrs = selectedYears,
    mos = selectedMonths,
    onlyDisputes = disputeOnly,
    country = portCountry,
    mode = counterpartyMode,
    company = companyKeyword,
    options = {},
  ) => {
    setLoading(true);
    setError(null);
    const normalizedCountry = String(country || '').trim();
    const normalizedCompany = String(company || '').trim();
    const where = buildWhereClause(yrs, mos, normalizedCountry);
    const res = await appClient.functions.invoke('salesforceDashboardFiltered', {
      mode: 'dashboard',
      where,
      trendYear: THIS_YEAR,
      disputeOnly: onlyDisputes,
      portCountry: normalizedCountry || null,
      companyFilterMode: mode,
      companyKeyword: normalizedCompany || null,
    }, { cache: true, force: options.force });
    setResponseMeta(res.data?.error ? { ...res.meta, cacheStatus: 'UNAVAILABLE' } : res.meta);
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setData(res.data);
      setLastRefresh(new Date(res.meta?.cachedAt || Date.now()));
    }
    setLoading(false);
  };

  const aiPeriodKey = `${selectedYears.slice().sort((a, b) => a - b).join(',')}|${selectedMonths.slice().sort((a, b) => a - b).join(',')}`;
  const runAiSearch = async (
    promptInput = aiPrompt,
    clarification = '',
    options = {},
  ) => {
    const prompt = String(promptInput || '').trim();
    if (prompt.length < 3) {
      setAiError('Enter a search request with at least 3 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setAiError(null);
    setAiSearch(null);
    setAiQuery({ prompt, clarification, periodKey: aiPeriodKey });
    setAiPrompt(prompt);
    try {
      const response = await appClient.functions.invoke('dashboardAiSearch', {
        prompt,
        clarification: clarification || null,
        selectedYears,
        selectedMonths,
      }, { cache: true, force: options.force });
      setResponseMeta(response.data?.error ? { ...response.meta, cacheStatus: 'UNAVAILABLE' } : response.meta);
      if (response.data?.error) {
        setAiError(response.data.error);
        setAiQuery(null);
        await load(selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword);
      } else {
        const nextAiSearch = response.data.aiSearch || null;
        setAiSearch(nextAiSearch);
        if (nextAiSearch?.status === 'ready') {
          setData(response.data);
          setTableSearch('');
          setAiVisibleCount(AI_TABLE_PAGE_SIZE);
          setLastRefresh(new Date(response.meta?.cachedAt || Date.now()));
        }
      }
    } catch (searchError) {
      setAiError(searchError?.message || 'AI Search is temporarily unavailable.');
      setAiQuery(null);
      await load(selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword);
    } finally {
      setLoading(false);
    }
  };

  const clearAiSearch = () => {
    setAiPrompt('');
    setAiQuery(null);
    setAiSearch(null);
    setAiError(null);
    setAiVisibleCount(AI_TABLE_PAGE_SIZE);
    load(selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword);
  };

  const refreshDashboard = () => {
    if (aiQuery?.prompt) {
      runAiSearch(aiQuery.prompt, aiQuery.clarification, { force: true });
      return;
    }
    load(selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword, { force: true });
  };

  useEffect(() => {
    const stored = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword }));
    clearTimeout(debounceRef.current);
    if (aiQuery) return undefined;
    debounceRef.current = setTimeout(() => {
      load(selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [selectedYears, selectedMonths, disputeOnly, portCountry, counterpartyMode, companyKeyword, aiQuery]);

  useEffect(() => {
    if (!aiQuery?.prompt || aiSearch?.status !== 'ready' || aiSearch.dateScope?.mode !== 'selected_period') return;
    if (aiQuery.periodKey === aiPeriodKey) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runAiSearch(aiQuery.prompt, aiQuery.clarification);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [aiPeriodKey, aiQuery, aiSearch?.dateScope?.mode, aiSearch?.status]);

  useEffect(() => {
    const stored = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, showAnalytics }));
  }, [showAnalytics]);

  useEffect(() => {
    if (location.hash !== '#filtered-stems' || loading || !data) return undefined;
    const timeout = window.setTimeout(() => {
      document.getElementById('filtered-stems')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [data, loading, location.hash]);

  // Filtered table rows: enforce selected years/months client-side as a strict safety net, then search
  const filteredStems = useMemo(() => {
    if (!data?.recentStems?.length) return data?.recentStems || [];
    if (aiSearch?.status === 'ready') return data.recentStems;
    const yearsSet = new Set(selectedYears);
    const monthsSet = new Set(selectedMonths);
    // Parse date string directly (e.g. "2026-04-30") to avoid any timezone issues.
    // If Delivery Date is blank, Expected Delivery Date controls filter inclusion.
    let stems = data.recentStems.filter(row => {
      const effectiveDate = row.Delivery_Date__c || row.Expected_Delivery_Date__c;
      if (!effectiveDate) return false;
      const parts = effectiveDate.split('-');
      const yr = Number(parts[0]);
      const mo = Number(parts[1]);
      return yearsSet.has(yr) && monthsSet.has(mo);
    });
    if (!tableSearch.trim()) return stems;
    const q = tableSearch.toLowerCase();
    const SEARCH_FIELDS = counterpartyMode === 'supplier'
      ? ['Name', 'KeyStem__c', 'Vessel__c', '_Supplier_Names', '_Product_Quantities', '_Extra_Cost_Names']
      : ['Name', 'KeyStem__c', 'Vessel__c', 'Buyer_Name__c', 'Buyer__c', '_Buyer_Group', '_Product_Quantities', '_Extra_Cost_Names'];
    return stems.filter(row =>
      SEARCH_FIELDS.some(f => row[f] != null && String(row[f]).toLowerCase().includes(q))
    );
  }, [data?.recentStems, tableSearch, selectedYears, selectedMonths, counterpartyMode, aiSearch?.status]);
  const aiSearchReady = aiSearch?.status === 'ready';
  const aiDateOverridesSelection = aiSearchReady && aiSearch.dateScope?.mode !== 'selected_period';
  const tableRecords = aiSearchReady
    ? filteredStems.slice(0, aiVisibleCount)
    : filteredStems;
  const aiCanShowMore = aiSearchReady && tableRecords.length < filteredStems.length;

  const dashboardTurnover = data?.turnoverTotal ?? data?.totalBuyer ?? null;
  const kpiMetrics = useMemo(() => {
    const grossMarginPct = dashboardTurnover ? (data.totalProfit / dashboardTurnover) * 100 : null;
    return { grossMarginPct };
  }, [data, dashboardTurnover]);

  const productFamilyKpis = useMemo(() => {
    const quantities = (data?.productFamilyQuantities || []).map((item) => ({
      family: String(item.family || 'Unspecified').toUpperCase(),
      quantity: Number(item.quantity || 0),
      unitOfMeasure: item.unitOfMeasure || 'MT',
    }));
    if (!quantities.length) {
      return PRODUCT_FAMILY_KPI_ORDER.map((family) => ({
        family,
        quantity: 0,
        unitOfMeasure: 'MT',
      }));
    }
    return quantities.sort((a, b) => (
      productFamilyRank(a.family) - productFamilyRank(b.family)
      || a.family.localeCompare(b.family)
      || a.unitOfMeasure.localeCompare(b.unitOfMeasure)
    ));
  }, [data?.productFamilyQuantities]);
  const productVolumeKpi = useMemo(() => {
    const totalsByUnit = new Map();
    for (const item of productFamilyKpis) {
      totalsByUnit.set(
        item.unitOfMeasure,
        (totalsByUnit.get(item.unitOfMeasure) || 0) + Number(item.quantity || 0),
      );
    }
    const hasMixedUnits = totalsByUnit.size > 1;
    const [unitOfMeasure = 'MT', totalQuantity = 0] = totalsByUnit.entries().next().value || [];
    return {
      totalQuantity: hasMixedUnits ? null : totalQuantity,
      unitOfMeasure,
      hasMixedUnits,
      breakdown: productFamilyKpis,
    };
  }, [productFamilyKpis]);

  const companySuggestions = useMemo(() => {
    const q = companyKeyword.trim().toLowerCase();
    return companyOptions
      .filter((name) => !q || String(name).toLowerCase().includes(q))
      .slice(0, 12);
  }, [companyKeyword, companyOptions]);

  const portCountrySuggestions = useMemo(() => {
    const q = portCountry.trim().toLowerCase();
    return portCountryOptions
      .filter((country) => !q || String(country).toLowerCase().includes(q))
      .slice(0, 12);
  }, [portCountry, portCountryOptions]);

  const selectCompanySuggestion = (name) => {
    setCompanyKeyword(name);
    setCompanySuggestionsOpen(false);
  };

  const selectPortCountrySuggestion = (country) => {
    setPortCountry(country);
    setPortCountrySuggestionsOpen(false);
  };

  const selectedYearLabel = selectedYears.slice().sort((a, b) => a - b).join(', ');
  const selectedMonthLabel = formatSelectedMonths(selectedMonths);
  const activeCounterparty = COUNTERPARTY_MODES.find((mode) => mode.value === counterpartyMode) || COUNTERPARTY_MODES[0];
  const activeAccountCount = counterpartyMode === 'supplier'
    ? data?.supplierAccountCount
    : (data?.buyerAccountCount ?? data?.accountCount);
  const monthlyCounterpartyNames = counterpartyMode === 'supplier'
    ? (data?.monthlySupplierNames || [])
    : (data?.monthlyBuyerNames || []);
  const monthlyCounterpartyNetPnl = counterpartyMode === 'supplier'
    ? (data?.monthlySupplierNetPnl || [])
    : (data?.monthlyBuyerNetPnl || []);
  const topCounterpartiesByNetPnl = counterpartyMode === 'supplier'
    ? (data?.topSuppliersByNetPnl || [])
    : (data?.topBuyersByNetPnl || []);
  const monthlyProductVolumeSeries = useMemo(() => {
    const suppliedSeries = data?.monthlyProductVolumeSeries || [];
    const baseSeries = suppliedSeries.length
      ? suppliedSeries
      : PRODUCT_FAMILY_KPI_ORDER.map((family) => ({
        key: family,
        family,
        unitOfMeasure: 'MT',
      }));
    const familyCounts = baseSeries.reduce((counts, series) => {
      counts.set(series.family, (counts.get(series.family) || 0) + 1);
      return counts;
    }, new Map());
    return baseSeries.map((series, index) => ({
      ...series,
      displayName: familyCounts.get(series.family) > 1
        ? `${series.family} · ${series.unitOfMeasure}`
        : series.family,
      color: familyCounts.get(series.family) > 1
        ? COLORS[index % COLORS.length]
        : (PRODUCT_VOLUME_COLORS[series.family] || COLORS[index % COLORS.length]),
    }));
  }, [data?.monthlyProductVolumeSeries]);
  const monthlyProductVolumes = data?.monthlyProductVolumes?.length
    ? data.monthlyProductVolumes
    : (data?.monthlyNetPnl || []).map((item) => {
      const row = {
        month: item.month,
        label: item.label,
        grossMarginPct: item.grossMarginPct ?? null,
      };
      for (const series of monthlyProductVolumeSeries) row[series.key] = 0;
      return row;
    });
  const monthlyVolumeUnits = new Set(monthlyProductVolumeSeries.map((series) => series.unitOfMeasure));
  const monthlyVolumeHasMixedUnits = monthlyVolumeUnits.size > 1;
  const monthlyVolumeAxisUnit = monthlyVolumeHasMixedUnits
    ? ''
    : (monthlyProductVolumeSeries[0]?.unitOfMeasure || 'MT');
  const monthlyVolumeUnitByName = new Map(
    monthlyProductVolumeSeries.map((series) => [series.displayName, series.unitOfMeasure]),
  );
  const monthlyTrendIsVolume = monthlyTrendMode === 'volume';
  const monthlyTrendData = monthlyTrendIsVolume ? monthlyProductVolumes : (data?.monthlyNetPnl || []);

  useEffect(() => {
    if (showAnalytics) {
      setFilteredTableHeight(null);
      return undefined;
    }
    const measure = () => {
      window.requestAnimationFrame(() => {
        const element = filteredStemsSectionRef.current;
        if (!element) return;
        const bottomPadding = window.innerWidth >= 1024 ? 32 : 24;
        const rect = element.getBoundingClientRect();
        const available = Math.floor(window.innerHeight - rect.top - bottomPadding);
        setFilteredTableHeight(Math.max(180, available));
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [showAnalytics, data, loading, error, filteredStems.length, filteredTableWide]);

  return (
    <div className={`p-6 lg:p-8 mx-auto transition-[max-width] duration-200 ${filteredTableWide ? 'max-w-none' : 'max-w-7xl'}`}>
      <PageHeader
        icon={SlidersHorizontal}
        eyebrow="Dashboard"
        title="Dashboard"
        meta={(
          <span className="flex flex-wrap items-center gap-2">
            <span>{lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')} · Auto-saved` : 'Auto-saved filters'}</span>
            {responseMeta ? <DataStatus meta={responseMeta} label="Salesforce" /> : null}
          </span>
        )}
        actions={(
          <>
            <PageMethodology {...DASHBOARD_METHODOLOGY} />
            <Button
              type="button"
              variant={showAnalytics ? 'default' : 'outline'}
              onClick={() => setShowAnalytics((current) => !current)}
              className="gap-2"
            >
              {showAnalytics ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showAnalytics ? 'Hide analytics' : 'Show analytics'}
            </Button>
            <Button variant="outline" onClick={refreshDashboard} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </Button>
          </>
        )}
      />

      {/* Filter panel */}
      <div className="relative z-40 overflow-visible bg-card rounded-xl border border-border p-4 mb-6 space-y-3">
        <form
          className="border-b border-border/70 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            runAiSearch();
          }}
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="relative min-w-0 flex-1">
                <Input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder='Search records, for example: stems with extra cost "SWAPS"'
                  maxLength={500}
                  className="h-10 pr-10"
                />
                {aiPrompt && (
                  <button
                    type="button"
                    onClick={() => setAiPrompt('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear AI search text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={loading || aiPrompt.trim().length < 3} className="gap-2">
                {loading && aiQuery ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
              {aiQuery && (
                <Button type="button" variant="outline" onClick={clearAiSearch} disabled={loading}>
                  Clear AI
                </Button>
              )}
            </div>
          </div>

          {aiSearch && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                <Sparkles className="h-3 w-3" />
                {aiSearch.status === 'ready' ? 'AI scope active' : 'Clarification required'}
              </span>
              {aiSearch.chips?.map((chip) => (
                <span key={chip} className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-foreground">
                  {chip}
                </span>
              ))}
              {aiSearch.dateScope?.label && (
                <span className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                  {aiSearch.dateScope.label}
                </span>
              )}
              {aiSearch.model?.label && (
                <span className="text-[11px] text-muted-foreground">{aiSearch.model.label}</span>
              )}
            </div>
          )}

          {aiSearch?.interpretation && (
            <p className="mt-2 text-xs text-muted-foreground">{aiSearch.interpretation}</p>
          )}

          {aiSearch?.status === 'needs_clarification' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">{aiSearch.clarification?.question}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {aiSearch.clarification?.options?.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                    onClick={() => runAiSearch(aiQuery?.prompt || aiPrompt, option)}
                    disabled={loading}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {aiError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{aiError}</span>
            </div>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <Label className="w-16 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Year</Label>
          <div className="flex flex-wrap gap-2">
            {YEARS.map(yr => (
              <button
                key={yr}
                onClick={() => toggleYear(yr)}
                disabled={aiDateOverridesSelection}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  selectedYears.includes(yr)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {yr}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDisputeOnly(false)}
              disabled={Boolean(aiQuery)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                !disputeOnly
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              All STEMs
            </button>
            <button
              onClick={() => setDisputeOnly(true)}
              disabled={Boolean(aiQuery)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                disputeOnly
                  ? 'bg-destructive text-destructive-foreground border-destructive'
                  : 'bg-muted/40 text-muted-foreground border-border hover:border-destructive/50 hover:text-destructive'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Disputed only
            </button>
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">View By</Label>
              <div className="flex gap-1.5">
                {COUNTERPARTY_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => updateCounterpartyMode(mode.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      counterpartyMode === mode.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="company-filter" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {activeCounterparty.label} Company
              </Label>
              <div className="relative z-50">
                <Input
                  id="company-filter"
                  value={companyKeyword}
                  onChange={(e) => {
                    setCompanyKeyword(e.target.value);
                    setCompanySuggestionsOpen(true);
                  }}
                  onFocus={() => setCompanySuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setCompanySuggestionsOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setCompanySuggestionsOpen(false);
                    if (e.key === 'Enter' && companySuggestions[0]) {
                      e.preventDefault();
                      selectCompanySuggestion(companySuggestions[0]);
                    }
                  }}
                  placeholder={`All ${activeCounterparty.plural.toLowerCase()}`}
                  className="h-8 w-56 text-xs"
                  autoComplete="off"
                  disabled={Boolean(aiQuery)}
                />
                {companySuggestionsOpen && companySuggestions.length > 0 && (
                  <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-border bg-background py-1 text-foreground shadow-2xl">
                    {companySuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectCompanySuggestion(name);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted/60"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {companyKeyword && !aiQuery && (
                <button onClick={() => setCompanyKeyword('')} className="text-xs text-primary hover:underline">
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="port-country-filter" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Port / Country
              </Label>
              <div className="relative z-50">
                <Input
                  id="port-country-filter"
                  value={portCountry}
                  onChange={(e) => {
                    setPortCountry(e.target.value);
                    setPortCountrySuggestionsOpen(true);
                  }}
                  onFocus={() => setPortCountrySuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setPortCountrySuggestionsOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setPortCountrySuggestionsOpen(false);
                    if (e.key === 'Enter' && portCountrySuggestions[0]) {
                      e.preventDefault();
                      selectPortCountrySuggestion(portCountrySuggestions[0]);
                    }
                  }}
                  placeholder="All ports/countries"
                  className="h-8 w-44 text-xs"
                  autoComplete="off"
                  disabled={Boolean(aiQuery)}
                />
                {portCountrySuggestionsOpen && portCountrySuggestions.length > 0 && (
                  <div className="absolute left-0 top-full z-[100] mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-border bg-background py-1 text-foreground shadow-2xl">
                    {portCountrySuggestions.map((country) => (
                      <button
                        key={country}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectPortCountrySuggestion(country);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted/60"
                      >
                        {country}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {portCountry && !aiQuery && (
                <button onClick={() => setPortCountry('')} className="text-xs text-primary hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Label className="w-16 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Month</Label>
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map(m => (
              <button
              key={m.value}
              onClick={() => toggleMonth(m.value)}
              disabled={aiDateOverridesSelection}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  selectedMonths.includes(m.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button onClick={toggleAllMonths} disabled={aiDateOverridesSelection} className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40">
            {selectedMonths.length === 12 ? 'Clear all' : 'Select all'}
          </button>
          <span className="text-xs text-muted-foreground">Fallback: Expected Delivery when Delivery Date is blank</span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {aiSearchReady && aiSearch.truncated && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {aiSearch.matchedCount?.toLocaleString()} STEMs match. Dashboard calculations and detailed rows currently include the newest {aiSearch.loadedCount?.toLocaleString()} records; refine the search for complete financial totals.
          </span>
        </div>
      )}

      {loading && showAnalytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(8)].map((_, i) => <div key={i} className="bg-card rounded-xl border border-border p-5 h-28 animate-pulse" />)}
        </div>
      )}

      {data && !loading && (
        <>
          {showAnalytics && (
          <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Matching STEMs" value={data.stemTotal?.toLocaleString() ?? '—'} icon={Package} color="blue" />
            <StatCard
              label={activeCounterparty.plural}
              value={activeAccountCount != null ? activeAccountCount.toLocaleString() : '—'}
              sub={`Distinct ${activeCounterparty.plural.toLowerCase()} in filtered STEMs`}
              icon={Building2}
              color="green"
            />
            <StatCard
              label="Turnover"
              value={dashboardTurnover != null ? `$${dashboardTurnover.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              sub="Including un-invoiced STEMs"
              icon={DollarSign}
              color="teal"
            />
            <StatCard
              label="Gross Profit Total"
              value={data.totalProfit != null ? `$${data.totalProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              sub="Including un-invoiced STEMs"
              icon={DollarSign}
              color="amber"
            />
            <StatCard
              label="Gross Margin %"
              value={kpiMetrics.grossMarginPct != null ? `${kpiMetrics.grossMarginPct.toFixed(1)}%` : '—'}
              sub="Gross Profit ÷ Turnover"
              icon={Percent}
              color="purple"
            />
            <StatCard
              label="Disputed"
              value={data.disputedCount != null ? data.disputedCount.toLocaleString() : '—'}
              sub={data.stemTotal > 0 && data.disputedCount != null
                ? `${((data.disputedCount / data.stemTotal) * 100).toFixed(1)}% of total`
                : undefined}
              icon={AlertCircle}
              color="red"
            />
            <div className="glass-surface bg-card rounded-xl border border-border p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-muted-foreground">Product Volume</p>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-50 text-cyan-600">
                  <Package className="w-4.5 h-4.5" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground font-dm tracking-tight">
                  {productVolumeKpi.hasMixedUnits
                    ? 'Mixed units'
                    : `${formatQuantity(productVolumeKpi.totalQuantity)} ${productVolumeKpi.unitOfMeasure}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">BDN Quantity or fallback mid-range</p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {productVolumeKpi.breakdown.map((item, index) => (
                  <span key={`${item.family}-${item.unitOfMeasure}`} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PRODUCT_VOLUME_COLORS[item.family] || COLORS[index % COLORS.length] }} />
                    <span>{item.family}</span>
                    <span className="font-semibold text-foreground">{formatQuantity(item.quantity)} {item.unitOfMeasure || 'MT'}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Monthly Gross Profit / Volume Trend */}
          {data.monthlyNetPnl?.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5 mb-8">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">
                    {monthlyTrendIsVolume ? 'Monthly Volume' : 'Monthly Gross Profit Trend'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {monthlyTrendIsVolume
                      ? `${monthlyVolumeHasMixedUnits ? 'Monthly volume by product family and UOM' : 'Combined monthly volume by product family'} with Gross Margin % for ${data.monthlyNetPnlYear || THIS_YEAR}`
                      : `Total Gross Profit and Gross Margin % by month for ${data.monthlyNetPnlYear || THIS_YEAR}`}
                  </p>
                </div>
                <div className="flex rounded-lg border border-border bg-muted/30 p-1">
                  <button
                    type="button"
                    onClick={() => setMonthlyTrendMode('profit')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      !monthlyTrendIsVolume ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Gross Profit
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonthlyTrendMode('volume')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      monthlyTrendIsVolume ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Monthly Volume
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart data={monthlyTrendData} barSize={44} margin={{ right: 8 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="value"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => monthlyTrendIsVolume
                      ? `${Math.round(v).toLocaleString()}${monthlyVolumeAxisUnit ? ` ${monthlyVolumeAxisUnit}` : ''}`
                      : `$${Math.round(v / 1000)}k`}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                    width={52}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Gross Margin %') return [`${Number(value).toFixed(1)}%`, name];
                      if (monthlyTrendIsVolume) {
                        const unit = monthlyVolumeUnitByName.get(name) || monthlyVolumeAxisUnit;
                        return [`${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`, name];
                      }
                      return [`$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Gross Profit'];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                  {monthlyTrendIsVolume ? (
                    monthlyProductVolumeSeries.map((series, index) => (
                      <Bar
                        key={series.key}
                        yAxisId="value"
                        dataKey={series.key}
                        name={series.displayName}
                        stackId={monthlyVolumeHasMixedUnits ? undefined : 'monthly-volume'}
                        fill={series.color}
                        radius={monthlyVolumeHasMixedUnits || index === monthlyProductVolumeSeries.length - 1
                          ? [4, 4, 0, 0]
                          : [0, 0, 0, 0]}
                      />
                    ))
                  ) : (
                    <Bar yAxisId="value" dataKey="netPnl" name="Gross Profit" radius={[4, 4, 0, 0]}>
                      {data.monthlyNetPnl.map((item, idx) => (
                        <Cell key={idx} fill={item.netPnl >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  )}
                  <Line
                    yAxisId="margin"
                    type="monotone"
                    dataKey="grossMarginPct"
                    name="Gross Margin %"
                    stroke="#7c3aed"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#7c3aed' }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Counterparty Gross Profit Trend */}
          {monthlyCounterpartyNetPnl.length > 0 && monthlyCounterpartyNames.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5 mb-8">
              <h3 className="text-sm font-semibold text-foreground mb-1">Monthly Gross Profit by {activeCounterparty.label}</h3>
              <p className="text-xs text-muted-foreground mb-4">Top {activeCounterparty.plural.toLowerCase()} by Gross Profit for {data.monthlyNetPnlYear || THIS_YEAR}</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthlyCounterpartyNetPnl} barSize={44}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v, name) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name]} />
                  {monthlyCounterpartyNames.map((name, idx) => (
                    <Bar key={name} dataKey={name} stackId="counterparties" fill={COLORS[idx % COLORS.length]} radius={idx === monthlyCounterpartyNames.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Charts */}
          {(data.stemByStatus?.length > 0 || data.stemByType?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {data.stemByStatus?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Status</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByStatus} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByStatus.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {data.stemByType?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Type</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByType} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByType.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Top 10 Counterparties by Gross Profit */}
          {topCounterpartiesByNetPnl.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5 mb-8">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Top 10 {activeCounterparty.plural} by Gross Profit
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({selectedYearLabel} · {selectedMonthLabel})
              </span>
            </h3>
            <div className="mt-4 space-y-2">
              {(() => {
                const maxAbs = Math.max(...topCounterpartiesByNetPnl.map(b => Math.abs(b.netPnl)), 1);
                return topCounterpartiesByNetPnl.map((b, i) => {
                  const pct = (Math.abs(b.netPnl) / maxAbs) * 100;
                  const isPos = b.netPnl >= 0;
                  return (
                    <div key={b.name} className="flex items-center gap-3">
                      <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">{i + 1}</span>
                      <span className="w-52 text-xs text-foreground truncate shrink-0" title={b.name}>{b.name}</span>
                      <div className="flex-1 bg-muted/50 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${isPos ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold w-28 text-right shrink-0 ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                        ${b.netPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
          )}
          </>
          )}

          {/* P&L Report */}
          <div
            id="filtered-stems"
            ref={filteredStemsSectionRef}
            className={`scroll-mt-6 ${
              !showAnalytics ? 'h-[70vh] min-h-[420px] lg:min-h-0' : ''
            } ${
              !showAnalytics && filteredTableHeight ? 'lg:h-[var(--filtered-table-height)]' : ''
            }`}
            style={!showAnalytics && filteredTableHeight
              ? { '--filtered-table-height': `${filteredTableHeight}px` }
              : undefined}
          >
            <TableShell
              title={aiSearchReady ? 'AI Search Results' : 'Filtered STEMs'}
              meta={aiSearchReady
                ? `${tableRecords.length.toLocaleString()} shown · ${Number(aiSearch.matchedCount || 0).toLocaleString()} matched`
                : `${filteredStems.length}${filteredStems.length !== data.recentStems?.length ? ` of ${data.recentStems?.length}` : ''} shown`}
              className={`flex flex-col ${showAnalytics ? 'h-[calc(100vh-7rem)] min-h-[360px]' : 'h-full min-h-0'}`}
              bodyClassName="min-h-0 flex-1 p-2"
              actions={(
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setFilteredTableWide((current) => !current)}
                  >
                    {filteredTableWide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    {filteredTableWide ? 'Normal width' : 'Wide view'}
                  </Button>
                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder={`Search by vessel, stem name, or ${activeCounterparty.label.toLowerCase()}…`}
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                      className="pl-8 h-8 text-xs"
                      disabled={aiSearchReady}
                    />
                    {tableSearch && (
                      <button onClick={() => setTableSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {aiCanShowMore && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setAiVisibleCount((current) => current + AI_TABLE_PAGE_SIZE)}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      Show more
                    </Button>
                  )}
                </>
              )}
            >
              <PnlTable
                records={tableRecords}
                counterpartyMode={counterpartyMode}
                scrollClassName="h-full min-h-0"
                onStemClick={setSelectedStemId}
              />
            </TableShell>
          </div>
        </>
      )}
      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={refreshDashboard}
      />
    </div>
  );
}
