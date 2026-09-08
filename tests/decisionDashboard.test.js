import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  dashboardCurrentYearDateWindows,
  dashboardFinancialBuckets,
  dashboardMonthlyComparison,
  dashboardMonthlyFinancialTrend,
  dashboardMonthlyYearOverYear,
  dashboardSupplierProductRows,
  dashboardCurrency,
  decodeDashboardCursor,
  decisionDashboardSummary,
  encodeDashboardCursor,
  normalizeDecisionDashboardFilters,
  priorEquivalentDateWindows,
  decisionDashboardSupplierAmount,
  yearOverYearDateWindows,
} from '../api/_decisionDashboard.js';

test('Dashboard calendar-year analytics use the Hong Kong current year', () => {
  assert.deepEqual(dashboardCurrentYearDateWindows(new Date('2025-12-31T16:30:00.000Z')), [
    { startDate: '2026-01-01', endDate: '2026-12-31' },
  ]);
});

test('keeps product suppliers aligned and shows only extra-cost-only suppliers', () => {
  const rows = dashboardSupplierProductRows({
    lineItems: [
      { sourceId: 'line-b', createdDate: '2026-08-02T00:00:00Z', supplierAccountId: 'supplier-a', supplierName: 'Supplier A', itemName: 'LSMGO', quantityLabel: '50 MT' },
      { sourceId: 'line-a', createdDate: '2026-08-01T00:00:00Z', supplierAccountId: 'supplier-a', supplierName: 'Supplier A', itemName: 'VLSFO', quantityLabel: '100 MT' },
      { sourceId: 'line-c', createdDate: '2026-08-03T00:00:00Z', supplierAccountId: 'supplier-b', supplierName: 'Same Supplier Name', itemName: 'HSFO', quantityLabel: '75 MT' },
      { sourceId: 'line-cancelled', supplierAccountId: 'supplier-c', itemName: 'Cancelled product', cancelled: true },
    ],
    extraCosts: [
      { sourceId: 'extra-hidden', supplierAccountId: 'supplier-a', supplierName: 'Supplier A', chargeProductName: 'Transport (Barge Included)' },
      { sourceId: 'extra-visible', createdDate: '2026-08-04T00:00:00Z', supplierAccountId: 'supplier-d', supplierName: 'Same Supplier Name', chargeProductName: 'Agency Fee' },
      { sourceId: 'extra-description', createdDate: '2026-08-05T00:00:00Z', description: 'Customs handling' },
      { sourceId: 'extra-cancelled', supplierAccountId: 'supplier-e', chargeProductName: 'Cancelled charge', cancelled: true },
    ],
  });

  assert.deepEqual(rows.map((row) => [row.sourceType, row.sourceId, row.supplierAccount?.id || null, row.itemName, row.quantityLabel]), [
    ['line_item', 'line-a', 'supplier-a', 'VLSFO', '100 MT'],
    ['line_item', 'line-b', 'supplier-a', 'LSMGO', '50 MT'],
    ['line_item', 'line-c', 'supplier-b', 'HSFO', '75 MT'],
    ['extra_cost', 'extra-visible', 'supplier-d', 'Agency Fee', null],
  ]);
});

test('falls back to the Salesforce extra-cost record number only after product and description', () => {
  assert.deepEqual(dashboardSupplierProductRows({
    extraCosts: [{ sourceId: 'extra-1', supplierAccountId: 'supplier-a', supplierName: 'Supplier A', recordName: 'E-24678' }],
  })[0], {
    sourceType: 'extra_cost',
    sourceId: 'extra-1',
    supplierAccount: { id: 'supplier-a', name: 'Supplier A' },
    itemName: 'E-24678',
    quantityLabel: null,
    unitOfMeasure: null,
  });
});

test('omits supplier-less extra costs from the summary while keeping line items visible', () => {
  assert.deepEqual(dashboardSupplierProductRows({
    lineItems: [{ sourceId: 'line-1', itemName: 'VLSFO' }],
    extraCosts: [
      { sourceId: 'transport', chargeProductName: 'Transport (Unknown)' },
      { sourceId: 'launch', chargeProductName: 'LAUNCH BOAT FEE' },
    ],
  }).map((row) => row.sourceId), ['line-1']);
});

test('supplier amount does not double count invoiced extra costs already in the Salesforce total', () => {
  const supplier = decisionDashboardSupplierAmount({
    invoicedSupplierAmount: 511_190.37,
    lineBuyAmount: 510_548.38,
    uninvoicedLineBuyAmount: 0,
    hasSupplierInvoice: true,
    uninvoicedExtraBuyAmount: 0,
    invoicedExtraBuyAmount: 641.99,
    qlikSupplierCost: 511_190.37,
  });
  assert.equal(supplier, 511_190.37);
  assert.ok(Math.abs(511_525.38 - supplier - 335.01) < 0.000001);
});

test('single-currency Salesforce records use the confirmed USD corporate currency', () => {
  assert.equal(dashboardCurrency(null), 'USD');
  assert.equal(dashboardCurrency('usd'), 'USD');
});

test('decision dashboard keeps financial totals in separate ISO currency buckets', () => {
  assert.deepEqual(dashboardFinancialBuckets([
    { currency: 'USD', buyer: 120, supplier: 80, costs: 5, brokerCommissions: 1, netPnl: 34 },
    { currency: 'EUR', buyer: 200, supplier: 150, costs: 10, brokerCommissions: 0, netPnl: 40 },
    { currency: 'USD', buyer: 20, supplier: 4, costs: 0, brokerCommissions: 0, netPnl: 16 },
  ]), [
    { currency: 'EUR', buyer: 200, supplier: 150, costs: 10, brokerCommissions: 0, netPnl: 40, stemCount: 1, grossMarginPct: 20 },
    { currency: 'USD', buyer: 140, supplier: 84, costs: 5, brokerCommissions: 1, netPnl: 50, stemCount: 2, grossMarginPct: 35.714285714285715 },
  ]);
});

test('financial totals are suppressed when a scope is incomplete', () => {
  const summary = decisionDashboardSummary([{ currency: 'USD', buyer: 10 }], { matchingCount: 2, processedCount: 1 });
  assert.equal(summary.complete, false);
  assert.equal(summary.financials, null);
});

test('filters use exact IDs and normalized country codes without text matching', () => {
  assert.deepEqual(normalizeDecisionDashboardFilters({
    accountIds: ['001000000000001', '001000000000001', ' 001000000000002 '],
    portIds: ['a0P000000000001'],
    countryCodes: ['hk', ' HK '],
    supplierIds: ['001000000000003'],
    supplierNames: ['Supplier A'],
  }), {
    accountIds: ['001000000000001', '001000000000002'], portIds: ['a0P000000000001'], countryCodes: ['HK'], supplierIds: ['001000000000003'], includeCancelled: false,
  });
});

test('complete financial scopes remain publishable beyond the former 3,000-record boundary', () => {
  const rows = Array.from({ length: 3_501 }, () => ({ currency: 'USD', buyer: 10, supplier: 6, netPnl: 4 }));
  const summary = decisionDashboardSummary(rows, { matchingCount: rows.length, processedCount: rows.length });
  assert.equal(summary.complete, true);
  assert.equal(summary.processedCount, 3_501);
  assert.equal(summary.financials[0].stemCount, 3_501);
  assert.equal(summary.financials[0].buyer, 35_010);
});

test('cursor round trips only valid Salesforce identifiers', () => {
  const cursor = encodeDashboardCursor(
    { Id: 'a01123456789012AAA', CreatedDate: '2026-08-01T12:00:00.000+0000' },
    { field: 'createdDate', direction: 'desc' },
  );
  assert.deepEqual(decodeDashboardCursor(cursor), {
    field: 'createdDate',
    direction: 'desc',
    value: '2026-08-01T12:00:00.000+0000',
    id: 'a01123456789012AAA',
  });
  const deliveryCursor = encodeDashboardCursor(
    { Id: 'a01123456789012AAA', Delivery_Date__c: '2026-08-01' },
    { field: 'deliveryDate', direction: 'asc' },
  );
  assert.deepEqual(decodeDashboardCursor(deliveryCursor), {
    field: 'deliveryDate', direction: 'asc', value: '2026-08-01', id: 'a01123456789012AAA',
  });
  assert.equal(decodeDashboardCursor('not-a-cursor'), null);
});

test('prior trend period has the same inclusive duration as selected scope', () => {
  assert.deepEqual(priorEquivalentDateWindows([{ startDate: '2026-08-01', endDate: '2026-08-31' }]), [{ startDate: '2026-07-01', endDate: '2026-07-31' }]);
});

test('year-over-year windows retain calendar dates and safely clamp leap day', () => {
  assert.deepEqual(yearOverYearDateWindows([
    { startDate: '2024-02-29', endDate: '2024-03-31' },
    { startDate: '2026-08-01', endDate: '2026-08-31' },
  ]), [
    { startDate: '2023-02-28', endDate: '2023-03-31' },
    { startDate: '2025-08-01', endDate: '2025-08-31' },
  ]);
});

test('calculates monthly YoY difference against the same calendar month', () => {
  assert.deepEqual(dashboardMonthlyYearOverYear([
    { month: '2026-07', currency: 'USD', netPnl: 150 },
    { month: '2026-08', currency: 'USD', netPnl: 75 },
  ], [
    { month: '2025-07', currency: 'USD', netPnl: 100 },
    { month: '2025-08', currency: 'USD', netPnl: 0 },
  ]), [
    { month: '2026-07', priorMonth: '2025-07', comparisonBasis: 'same_calendar_month', currency: 'USD', currentValue: 150, priorValue: 100, difference: 50, differencePct: 50 },
    { month: '2026-08', priorMonth: '2025-08', comparisonBasis: 'same_calendar_month', currency: 'USD', currentValue: 75, priorValue: 0, difference: 75, differencePct: null },
  ]);
});

test('exposes the prior-year actual monthly margin for same-month chart alignment', () => {
  assert.deepEqual(dashboardMonthlyYearOverYear([
    { month: '2026-07', currency: 'USD', grossMarginPct: 12.5 },
    { month: '2026-08', currency: 'USD', grossMarginPct: 8 },
  ], [
    { month: '2025-07', currency: 'USD', grossMarginPct: 10 },
    { month: '2025-08', currency: 'USD', grossMarginPct: 5 },
  ], { valueField: 'grossMarginPct' }), [
    { month: '2026-07', priorMonth: '2025-07', comparisonBasis: 'same_calendar_month', currency: 'USD', currentValue: 12.5, priorValue: 10, difference: 2.5, differencePct: 25 },
    { month: '2026-08', priorMonth: '2025-08', comparisonBasis: 'same_calendar_month', currency: 'USD', currentValue: 8, priorValue: 5, difference: 3, differencePct: 60 },
  ]);
});

test('calculates each monthly gross margin from that month totals rather than a selected-period average', () => {
  assert.deepEqual(dashboardMonthlyFinancialTrend([
    { deliveryDate: '2026-07-10', currency: 'USD', buyer: 600, supplier: 530, brokerCommissions: 10, netPnl: 60 },
    { deliveryDate: '2026-07-20', currency: 'USD', buyer: 400, supplier: 350, brokerCommissions: 10, netPnl: 40 },
    { deliveryDate: '2026-08-10', currency: 'USD', buyer: 100, supplier: 40, brokerCommissions: 10, netPnl: 50 },
  ]), [
    { month: '2026-07', currency: 'USD', buyer: 1000, supplier: 880, brokerCommissions: 20, netPnl: 100, stemCount: 2, grossMarginPct: 10 },
    { month: '2026-08', currency: 'USD', buyer: 100, supplier: 40, brokerCommissions: 10, netPnl: 50, stemCount: 1, grossMarginPct: 50 },
  ]);
});

test('combines actual current and prior-year gross profit, margin, and MT volume by currency and month', () => {
  const rows = dashboardMonthlyComparison({
    currentFinancial: [
      { month: '2026-07', currency: 'USD', netPnl: 100, grossMarginPct: 10 },
      { month: '2026-08', currency: 'USD', netPnl: -20, grossMarginPct: -4 },
      { month: '2026-07', currency: 'EUR', netPnl: 30, grossMarginPct: 6 },
    ],
    priorFinancial: [
      { month: '2025-07', currency: 'USD', netPnl: 80, grossMarginPct: 8 },
      { month: '2025-07', currency: 'EUR', netPnl: 25, grossMarginPct: 5 },
    ],
    currentVolume: [
      { month: '2026-07', currency: 'USD', family: 'VLSFO', unitOfMeasure: 'MT', quantity: 100 },
      { month: '2026-07', currency: 'USD', family: 'LSMGO', unitOfMeasure: 'MT', quantity: 25 },
      { month: '2026-07', currency: 'USD', family: 'Other', unitOfMeasure: 'M3', quantity: 999 },
      { month: '2026-07', currency: 'EUR', family: 'HSFO', unitOfMeasure: 'MT', quantity: 50 },
    ],
    priorVolume: [
      { month: '2025-07', currency: 'USD', family: 'VLSFO', unitOfMeasure: 'MT', quantity: 90 },
      { month: '2025-07', currency: 'EUR', family: 'HSFO', unitOfMeasure: 'MT', quantity: 40 },
    ],
  });
  assert.deepEqual(rows[0], {
    month: '2026-07', priorMonth: '2025-07', currency: 'EUR', unitOfMeasure: 'MT',
    currentGrossProfit: 30, priorGrossProfit: 25, currentGrossMarginPct: 6, priorGrossMarginPct: 5,
    currentVolume: 50, priorVolume: 40,
    currentProductVolumes: [{ family: 'HSFO', quantity: 50, unitOfMeasure: 'MT' }],
    priorProductVolumes: [{ family: 'HSFO', quantity: 40, unitOfMeasure: 'MT' }],
    priorComplete: true, priorAvailable: true,
  });
  assert.equal(rows.find((row) => row.month === '2026-07' && row.currency === 'USD').currentVolume, 125);
  assert.equal(rows.find((row) => row.month === '2026-08').currentGrossProfit, -20);
  assert.equal(rows.find((row) => row.month === '2026-08').priorGrossProfit, null);
});

test('calendar-year monthly comparison always returns January through December with honest gaps', () => {
  const rows = dashboardMonthlyComparison({
    calendarYear: '2026',
    currentFinancial: [{ month: '2026-08', currency: 'USD', netPnl: 50, grossMarginPct: 5 }],
    priorFinancial: [{ month: '2025-01', currency: 'USD', netPnl: 20, grossMarginPct: 2 }],
    currentVolume: [{ month: '2026-08', currency: 'USD', family: 'VLSFO', unitOfMeasure: 'MT', quantity: 100 }],
    priorVolume: [{ month: '2025-01', currency: 'USD', family: 'HSFO', unitOfMeasure: 'MT', quantity: 40 }],
  });

  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map((row) => row.month), Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`));
  assert.equal(rows[0].currentGrossProfit, null);
  assert.equal(rows[0].currentVolume, null);
  assert.equal(rows[0].priorGrossProfit, 20);
  assert.equal(rows[0].priorVolume, 40);
  assert.equal(rows[7].currentGrossProfit, 50);
  assert.equal(rows[7].currentVolume, 100);
  assert.equal(rows[7].priorGrossProfit, null);
});

test('incomplete prior-year scope leaves gaps without suppressing current monthly values', () => {
  assert.deepEqual(dashboardMonthlyComparison({
    currentFinancial: [{ month: '2026-08', currency: 'USD', netPnl: 50, grossMarginPct: 5 }],
    priorFinancial: [{ month: '2025-08', currency: 'USD', netPnl: 999, grossMarginPct: 99 }],
    currentVolume: [{ month: '2026-08', currency: 'USD', family: 'VLSFO', unitOfMeasure: 'MT', quantity: 100 }],
    priorVolume: [{ month: '2025-08', currency: 'USD', family: 'VLSFO', unitOfMeasure: 'MT', quantity: 999 }],
    priorComplete: false,
  })[0], {
    month: '2026-08', priorMonth: '2025-08', currency: 'USD', unitOfMeasure: 'MT',
    currentGrossProfit: 50, priorGrossProfit: null, currentGrossMarginPct: 5, priorGrossMarginPct: null,
    currentVolume: 100, priorVolume: null,
    currentProductVolumes: [{ family: 'VLSFO', quantity: 100, unitOfMeasure: 'MT' }],
    priorProductVolumes: [], priorComplete: false, priorAvailable: false,
  });
});

test('new dashboard handlers are authenticated, live-only, and supplier matching checks both child objects', async () => {
  const [api, policies, analytics, rankings] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlerPolicyRegistry.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/DashboardAnalytics.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/dashboardAccountRankings.js', import.meta.url), 'utf8'),
  ]);
  for (const handler of ['dashboardSummary', 'dashboardStemList', 'dashboardAnalytics']) {
    assert.equal(api.includes(`${handler}: ['dashboard']`), true);
    assert.match(api, new RegExp(`${handler},`));
    assert.match(policies, new RegExp(`${handler}: readPolicy\\(\\{\\"cache\\":\\"server\\"`));
  }
  assert.match(api, /FROM STEM_Line_Item__c WHERE Cancelled__c = false/);
  assert.match(api, /FROM STEM_Extra_Cost__c WHERE Cancelled__c = false/);
  assert.match(api, /optionType === 'groups'/);
  assert.match(api, /label: `COUNTRY - \$\{countryCode\}`/);
  assert.match(api, /accountIds: \[\.\.\.buyerIds\]\.sort\(\)/);
  const loader = api.slice(api.indexOf('async function loadDecisionDashboardScope'), api.indexOf('async function salesforceDashboardFilteredUncached'));
  assert.doesNotMatch(loader, /LIMIT 3000/);
  assert.match(loader, /limit: pageOnly \? pageSize \+ 1 : null/);
  assert.match(loader, /SELECT COUNT\(Id\) total FROM stem__c/);
  assert.match(loader, /decisionDashboardBuyerBrokerCommissionField\(buyerBrokerDescribe\.fields/);
  assert.match(loader, /buyerBrokerCommissionField\s*\?\s*decisionDashboardRowsForStemIds/);
  assert.doesNotMatch(api, /pricingFinancialQuantity/);
  assert.match(loader, /productVolumes/);
  assert.match(loader, /productQuantities/);
  assert.match(loader, /monthlyVolume/);
  assert.doesNotMatch(loader, /monthlyCounterparties|dashboardMonthlyCounterpartySeries/);
  assert.match(loader, /monthlyVolumeYearOverYear/);
  assert.match(loader, /monthlyComparison/);
  assert.match(loader, /dashboardCurrentYearDateWindows/);
  assert.match(loader, /calendarYear: currentYear/);
  assert.match(loader, /decisionDashboardInternalAccountIdentity/);
  assert.match(loader, /normalizedGroupIdentity/);
  assert.match(loader, /Group_Name__c/);
  assert.match(api, /excludedAccountIds: internalAccountIds/);
  assert.match(rankings, /excludedAccountIds\.has\(entity\.id\)/);
  assert.doesNotMatch(loader, /\['STEM__c', 'Commission_Lumpsum__c'\]/);
  assert.doesNotMatch(analytics, /Monthly gross profit by|MonthlyCounterpartyChart|monthlyCounterparties/);
  assert.match(analytics, /MonthlyPerformanceChart/);
  assert.match(analytics, /January–December/);
  assert.match(analytics, /TopAccounts/);
});
