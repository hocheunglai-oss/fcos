import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Activity, LayoutDashboard, RefreshCw } from 'lucide-react';
import '../../src/styles/fonts.css';
import '../../src/index.css';
import { appClient } from '../../src/api/appClient';
import DataStatus from '../../src/components/common/DataStatus';
import PageHeader from '../../src/components/common/PageHeader';
import PaymentDataReliabilityBadge from '../../src/components/common/PaymentDataReliabilityBadge';
import AccountCreditDirectory from '../../src/components/dashboard/AccountCreditDirectory';
import DashboardAnalytics from '../../src/components/dashboard/DashboardAnalytics';
import DashboardFilterBar from '../../src/components/dashboard/DashboardFilterBar';
import DashboardKpis from '../../src/components/dashboard/DashboardKpis';
import DashboardStemTable from '../../src/components/dashboard/DashboardStemTable';
import { Button } from '../../src/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../src/components/ui/tabs';
import { WorkspaceChromeProvider } from '../../src/components/workspace/WorkspaceChrome';

// This module is a Vite-only visual fixture. Replacing the client call here keeps
// the real filter component interactive without allowing any API request.
const FIXTURE_COUNTERPARTIES = [
  { entityKey: 'account:fixture-1', entityType: 'account', entityId: 'fixture-1', name: 'Synthetic Pacific Bunkering and Marine Logistics Holdings Limited', roles: ['buyer', 'supplier'], buyerStemCount: 18, supplierStemCount: 12, clKey: 'SYN-001' },
];
const FIXTURE_META = { cached: true, cacheLayer: 'fixture', cacheStatus: 'FIXTURE', cachedAt: '2026-09-05T00:00:00.000Z', requestId: null, salesforceCalls: 0 };

const currentYear = 2026;
const monthlyValues = [
  [146_200, 7_850, 5.2, 124_800, 7_110, 4.8],
  [0, 0, 0, 95_400, 5_980, 4.3],
  [182_450, 8_910, 5.9, 156_000, 8_460, 5.1],
  [-52_300, 4_240, -3.4, 104_800, 6_300, 4.4],
  [225_600, 10_150, 6.4, 197_300, 9_520, 5.7],
  [199_800, 9_890, 6.0, null, null, null],
  [265_400, 11_420, 6.8, 233_200, 10_900, 6.1],
  [218_900, 10_310, 5.8, 201_750, 9_670, 5.4],
  [null, null, null, 188_800, 9_240, 5.2],
  [294_100, 12_580, 7.0, 251_900, 11_760, 6.2],
  [310_400, 13_020, 7.1, 278_100, 12_480, 6.5],
  [342_800, 14_110, 7.4, 299_700, 13_230, 6.8],
];

const monthlyRows = monthlyValues.map(([currentGrossProfit, currentVolume, currentGrossMarginPct, priorGrossProfit, priorVolume, priorGrossMarginPct], index) => ({
  month: `${currentYear}-${String(index + 1).padStart(2, '0')}`,
  priorMonth: `${currentYear - 1}-${String(index + 1).padStart(2, '0')}`,
  currency: 'USD',
  currentGrossProfit,
  currentVolume,
  currentGrossMarginPct,
  priorGrossProfit,
  priorVolume,
  priorGrossMarginPct,
  currentProductVolumes: currentVolume == null ? [] : [{ family: index % 2 ? 'VLSFO' : 'LSMGO', quantity: currentVolume }],
  priorProductVolumes: priorVolume == null ? [] : [{ family: index % 2 ? 'HSFO' : 'VLSFO', quantity: priorVolume }],
}));

const dashboardSummary = {
  complete: true,
  generatedAt: '2026-09-05T00:00:00.000Z',
  financials: [{ currency: 'USD', netPnl: 2_133_350, grossMarginPct: 5.9, buyer: 36_145_000 }],
  productVolumeKpi: { quantity: 102_470, unitOfMeasure: 'MT', breakdown: [{ family: 'VLSFO', quantity: 61_240, unitOfMeasure: 'MT' }, { family: 'LSMGO', quantity: 41_230, unitOfMeasure: 'MT' }] },
  matchingCount: 128,
  accountCount: 18,
  disputedCount: 3,
  priorPeriod: { stemCount: 116 },
};

const accountNames = [
  'Synthetic Pacific Bunkering and Marine Logistics Holdings Limited',
  'North Atlantic Renewable Fuels Trading and Supply Corporation',
  'Harbour Energy Solutions International (Singapore) Private Limited',
  'Mediterranean Offshore Fleet Management and Chartering SA',
  'Northern Star Maritime Procurement Services Incorporated',
  'Equatorial Marine Fuels and Lubricants Distribution Company',
  'Western Seaways Bulk Carriers Commercial Operations Limited',
  'Bluewater Global Shipping and Marine Services Group',
  'Continental Port Agency and Bunker Coordination Limited',
  'Oceanic Vessel Management and Technical Support Company',
];

const directoryAccounts = [
  { entityKey: 'group:fixture-group-1', entityType: 'group', entityId: 'fixture-group-1', name: 'GROUP Synthetic Pacific Energy and Marine Services', clKey: 'SYN-GRP', roles: ['buyer', 'supplier'], buyerStemCount: 38, supplierStemCount: 26, buyerGrossProfitByCurrency: [{ currency: 'USD', grossProfit: 844_200 }], supplierGrossProfitByCurrency: [{ currency: 'USD', grossProfit: 271_900 }] },
  { entityKey: 'account:fixture-1', entityType: 'account', entityId: 'fixture-1', name: accountNames[0], clKey: 'SYN-001', roles: ['buyer', 'supplier'], buyerStemCount: 18, supplierStemCount: 12, buyerGrossProfitByCurrency: [{ currency: 'USD', grossProfit: 342_800 }], supplierGrossProfitByCurrency: [{ currency: 'USD', grossProfit: 118_400 }] },
];

const directoryExposures = [
  { entityKey: 'group:fixture-group-1', buyer: { complete: true, byCurrency: [{ currency: 'USD', exposure: 4_800_000, openStemCount: 14 }] }, supplier: { complete: true, byCurrency: [{ currency: 'USD', exposure: 2_175_000, openStemCount: 9 }] }, net: { complete: true, byCurrency: [{ currency: 'USD', amount: 2_625_000 }] } },
  { entityKey: 'account:fixture-1', buyer: { complete: true, byCurrency: [{ currency: 'USD', exposure: 1_920_000, openStemCount: 6 }] }, supplier: { complete: true, byCurrency: [{ currency: 'USD', exposure: 860_000, openStemCount: 4 }] }, net: { complete: true, byCurrency: [{ currency: 'USD', amount: 1_060_000 }] } },
];

appClient.functions.invoke = async (name) => {
  const dataByFunction = {
    dashboardCounterpartySearch: { results: FIXTURE_COUNTERPARTIES },
    dashboardAccountCreditDirectory: { accounts: directoryAccounts, nextCursor: null, meta: { redacted: true, cache: 'fixture', returnedCount: directoryAccounts.length, direction: 'both' } },
    dashboardAccountExposureBatch: { exposures: directoryExposures, meta: { redacted: true, cache: 'fixture', complete: true, returnedCount: directoryExposures.length } },
  };
  return { data: dataByFunction[name] || { error: `Fixture has no response for ${name}.` }, meta: FIXTURE_META };
};

const analyticsData = {
  trend: { monthlyComparison: { calendarYear: currentYear, complete: true, rows: monthlyRows } },
  rankings: { accountsByNetPnl: accountNames.map((name, index) => ({ accountId: `fixture-account-${index + 1}`, name, currency: 'USD', netPnl: [342_800, 310_400, 294_100, 265_400, 225_600, 218_900, 199_800, 182_450, 146_200, -52_300][index] })) },
};

const stemRows = [
  { id: 'fixture-stem-1', name: 'SYN-2026-001', deliveryDate: '2026-01-18', deliveryDateSource: 'delivery', vessel: 'MV Fixture Integrity', account: { id: 'fixture-account-1', name: accountNames[0] }, supplierAccounts: [{ id: 'fixture-supplier-1', name: 'Fixture Coastal Supply Company Limited' }], supplierProductRows: [{ sourceType: 'product', sourceId: 'fixture-product-1', supplierAccount: { id: 'fixture-supplier-1', name: 'Fixture Coastal Supply Company Limited' }, itemName: 'VLSFO 0.5%', quantityLabel: '1,250 MT' }], port: 'Singapore / SG', turnover: 2_810_000, grossProfit: 146_200, currency: 'USD', disputeStatus: '—' },
  { id: 'fixture-stem-2', name: 'SYN-2026-002', deliveryDate: '2026-04-06', deliveryDateSource: 'expected', vessel: 'MV Synthetic Horizon', account: { id: 'fixture-account-4', name: accountNames[3] }, supplierAccounts: [{ id: 'fixture-supplier-2', name: 'Fixture Northern Marine Fuels GmbH' }], supplierProductRows: [{ sourceType: 'product', sourceId: 'fixture-product-2', supplierAccount: { id: 'fixture-supplier-2', name: 'Fixture Northern Marine Fuels GmbH' }, itemName: 'LSMGO', quantityLabel: '640 MT' }], port: 'Rotterdam / NL', turnover: 1_520_000, grossProfit: -52_300, currency: 'USD', disputeStatus: 'Disputed' },
  { id: 'fixture-stem-3', name: 'SYN-2026-003', deliveryDate: '2026-07-29', deliveryDateSource: 'delivery', vessel: 'MV Data Boundary', account: { id: 'fixture-account-2', name: accountNames[1] }, supplierAccounts: [{ id: 'fixture-supplier-3', name: 'Fixture East Asia Bunker Operations Corporation' }], supplierProductRows: [{ sourceType: 'extra_cost', sourceId: 'fixture-cost-1', supplierAccount: { id: 'fixture-supplier-3', name: 'Fixture East Asia Bunker Operations Corporation' }, itemName: 'Canal surcharge', quantityLabel: 'USD 12,000' }], port: 'Busan / KR', turnover: 3_900_000, grossProfit: 265_400, currency: 'USD', disputeStatus: '—' },
];

const initialFilters = {
  datePreset: 'custom',
  selectedYears: [currentYear],
  selectedMonths: Array.from({ length: 12 }, (_, index) => index + 1),
  disputeOnly: false,
  counterpartyMode: 'buyer',
  counterparty: null,
  company: '', companyId: '', group: '', groupId: '', groupAccountIds: [],
  port: '', portId: '', country: '', countryCode: '',
};

function FixtureDashboard() {
  const [filters, setFilters] = useState(initialFilters);
  const [wide, setWide] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('overview');
  const dashboardRootRef = useRef(null);
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
  const headerMeta = <span className="flex flex-wrap items-center gap-2"><DataStatus meta={FIXTURE_META} label="Data" compact /><PaymentDataReliabilityBadge /><span className="text-xs text-amber-900">Synthetic UI fixture — not live Salesforce data</span></span>;
  const headerActions = <><Button type="button" size="sm" variant="outline" onClick={() => {}}>Methodology</Button><Button type="button" size="sm" variant="outline" onClick={() => {}}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button></>;
  return <WorkspaceChromeProvider><div className="app-workspace-shell relative" data-testid="fixture-shell" style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
    <aside className="app-workspace-sidebar app-navigation-material relative flex shrink-0 flex-col items-center border-r border-border py-3" style={{ width: '86px', minWidth: '86px', maxWidth: '86px' }} aria-label="Fixture navigation"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/80 bg-white/75 text-xs font-bold shadow-sm">FC</div><div className="mt-6 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><LayoutDashboard className="h-4 w-4" /></div></aside>
    <main id="fcos-main-content" tabIndex={-1} className="app-workspace-main" style={{ height: '100vh', display: 'flex', minWidth: 0, flex: '1 1 auto', flexDirection: 'column', overflow: 'hidden' }}><div style={{ position: 'relative', minHeight: 0, flex: '1 1 auto' }}><button type="button" className="absolute right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm" aria-label="Synthetic draggable market pulse placeholder" title="Synthetic draggable market pulse placeholder"><Activity className="h-4 w-4" /></button><div className="app-workspace-scroll" style={{ height: '100%', minHeight: 0, overflow: 'auto' }}><main ref={dashboardRootRef} className={`workspace-page workspace-dashboard mx-auto w-full p-3 sm:p-6 lg:p-8 ${wide ? 'max-w-none' : 'max-w-[1600px]'}`}>
      <PageHeader icon={LayoutDashboard} title="Dashboard" inlineMeta meta={headerMeta} actions={headerActions} />
      <DashboardFilterBar showPerspective={tab !== 'accounts'} filters={filters} years={[currentYear, currentYear - 1, currentYear - 2]} portOptions={[{ id: 'fixture-singapore', name: 'Singapore', kind: 'port' }, { value: 'SG', countryCode: 'SG', label: 'Singapore', kind: 'country' }]} loading={false} onChange={setFilters} onReset={() => setFilters(initialFilters)} onAiSearch={() => {}} />
      <Tabs value={tab} onValueChange={setTab}><TabsList className="mb-4 w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="stems">STEMs</TabsTrigger><TabsTrigger value="accounts">Accounts</TabsTrigger></TabsList>
        <TabsContent value="overview" className="space-y-4"><DashboardKpis summary={dashboardSummary} /><DashboardAnalytics data={analyticsData} loading={false} error="" onLoad={() => {}} counterpartyMode={filters.counterpartyMode} onAccountClick={() => {}} /></TabsContent>
        <TabsContent value="stems"><DashboardStemTable result={{ rows: stemRows, page: 1, pageSize: 25, matchingCount: stemRows.length, sort: {} }} loading={false} search={search} wide={wide} onWideChange={setWide} onSearch={setSearch} onPrevious={() => {}} onNext={() => {}} onSortChange={() => {}} onStemClick={() => {}} onAccountClick={() => {}} /></TabsContent>
        <TabsContent value="accounts"><AccountCreditDirectory counterparty={null} dateWindows={[{ startDate: '2026-01-01', endDate: '2026-12-31' }]} disputeOnly={false} filters={{ portIds: [], countryCodes: [] }} onOpen={() => {}} /></TabsContent>
      </Tabs>
    </main></div></div></main>
  </div></WorkspaceChromeProvider>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><FixtureDashboard /></BrowserRouter>);
