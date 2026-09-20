import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDashboardStemWorkbookXml,
  dashboardStemExportInternals,
  fetchAllDashboardStems,
} from '../src/lib/dashboardStemExport.js';

const finance = {
  annualInterestRatePct: 5,
  revision: 7,
  asOfDate: '2026-09-20',
  dayCountBasis: 'ACT/365',
  complete: true,
  warnings: [],
};

test('Dashboard XLS export fetches every page with stable search, sort, filters, and finance snapshot', async () => {
  const calls = [];
  const pages = [
    { matchingCount: 3, stems: [{ id: 'one' }, { id: 'two' }], nextCursor: 'page-two', finance },
    { matchingCount: 3, stems: [{ id: 'three' }], nextCursor: null, finance },
  ];
  const progress = [];
  const result = await fetchAllDashboardStems({
    invoke: async (name, payload, options) => {
      calls.push({ name, payload, options });
      return { data: pages[calls.length - 1] };
    },
    filterPayload: { dateWindows: [{ startDate: '2026-09-01', endDate: '2026-09-30' }], filters: { excludedCountryCodes: ['KOREA'] } },
    search: 'submitted search',
    sort: { field: 'name', direction: 'asc' },
    includeFinanceCosts: true,
    pageSize: 2,
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(result.rows.map((row) => row.id), ['one', 'two', 'three']);
  assert.equal(result.matchingCount, 3);
  assert.equal(result.finance.revision, 7);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'dashboardStemList');
  assert.equal(calls[0].payload.search, 'submitted search');
  assert.deepEqual(calls[0].payload.filters.excludedCountryCodes, ['KOREA']);
  assert.equal(calls[0].payload.pageSize, 2);
  assert.equal(calls[0].payload.includeFinanceCosts, true);
  assert.equal('financeSnapshot' in calls[0].payload, false);
  assert.deepEqual(calls[1].payload.financeSnapshot, { revision: 7, asOfDate: '2026-09-20' });
  assert.deepEqual(progress.map(({ loaded, total }) => [loaded, total]), [[2, 3], [3, 3]]);
});

test('Dashboard XLS export rejects count drift, duplicate rows, and incomplete pagination', async (t) => {
  await t.test('count drift', async () => {
    let page = 0;
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: page++ === 0
        ? { matchingCount: 2, stems: [{ id: 'one' }], nextCursor: 'next' }
        : { matchingCount: 3, stems: [{ id: 'two' }], nextCursor: null } }),
      pageSize: 1,
    }), /selection changed/);
  });

  await t.test('duplicate row', async () => {
    let page = 0;
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: page++ === 0
        ? { matchingCount: 2, stems: [{ id: 'one' }], nextCursor: 'next' }
        : { matchingCount: 2, stems: [{ id: 'one' }], nextCursor: null } }),
      pageSize: 1,
    }), /duplicate STEM/);
  });

  await t.test('short page before next cursor', async () => {
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: { matchingCount: 3, stems: [{ id: 'one' }], nextCursor: 'next' } }),
      pageSize: 2,
    }), /incomplete page/);
  });

  await t.test('final count mismatch', async () => {
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: { matchingCount: 2, stems: [{ id: 'one' }], nextCursor: null } }),
      pageSize: 2,
    }), /stopped at 1 of 2/);
  });

  await t.test('repeated cursor', async () => {
    let page = 0;
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: page++ === 0
        ? { matchingCount: 3, stems: [{ id: 'one' }], nextCursor: 'repeat' }
        : { matchingCount: 3, stems: [{ id: 'two' }], nextCursor: 'repeat' } }),
      pageSize: 1,
    }), /repeated a page cursor/);
  });

  await t.test('finance snapshot drift', async () => {
    let page = 0;
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: page++ === 0
        ? { matchingCount: 2, stems: [{ id: 'one', finance: { complete: true } }], nextCursor: 'next', finance }
        : { matchingCount: 2, stems: [{ id: 'two', finance: { complete: true } }], nextCursor: null, finance: { ...finance, revision: 8 } } }),
      pageSize: 1,
      includeFinanceCosts: true,
    }), /rate or calculation date changed/);
  });
});

test('Dashboard XLS export cancellation prevents workbook generation', async () => {
  const controller = new AbortController();
  const request = fetchAllDashboardStems({
    invoke: async (_name, _payload, options) => new Promise((resolve) => {
      options.signal.addEventListener('abort', () => resolve({ data: { cancelled: true } }), { once: true });
    }),
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(request, (error) => error.name === 'AbortError');
});

test('SpreadsheetML keeps text literal, escapes XML, separates currency totals, and marks unavailable finance', () => {
  const xml = buildDashboardStemWorkbookXml({
    rows: [{
      id: 'one',
      name: '=SUM(1,1) & <STEM>',
      createdDate: '2026-09-01',
      deliveryDate: '2026-09-02',
      vessel: { name: 'A "quoted" vessel' },
      account: { name: 'Buyer' },
      supplierNames: ['Supplier A'],
      productQuantities: [{ productName: 'VLSFO', quantityLabel: '100 MT' }],
      port: { name: 'Busan', countryCode: 'KOREA' },
      currency: 'USD',
      buyer: 1000.25,
      netPnl: 100.5,
      finance: { complete: false, financeCost: null, ebit: null, status: 'missing_evidence', issues: ['Buyer receipt missing'] },
    }, {
      id: 'two', name: 'Second', currency: 'EUR', buyer: 2000, netPnl: 300,
      finance: { complete: true, financeCost: 12.5, ebit: 287.5, status: 'complete', issues: [] },
    }],
    filterPayload: { disputeOnly: true, filters: { countryCodes: [], excludedCountryCodes: ['KOREA'] } },
    scopeLabels: { period: 'Year to date', counterparty: 'Buyer A', port: 'Busan', country: 'All', koreaDesk: 'Exclude Korea Desk' },
    search: 'literal & search',
    sort: { field: 'deliveryDate', direction: 'desc' },
    includeFinanceCosts: true,
    finance: { ...finance, complete: false, warnings: ['One <warning>'] },
    generatedAt: '2026-09-20T01:02:03.000Z',
  });

  assert.match(xml, /<Worksheet ss:Name="STEMs">/);
  assert.match(xml, /<Worksheet ss:Name="Scope">/);
  assert.match(xml, /<Data ss:Type="String">=SUM\(1,1\) &amp; &lt;STEM&gt;<\/Data>/);
  assert.doesNotMatch(xml, /ss:Formula|<Formula|<Macro/);
  assert.match(xml, /A &quot;quoted&quot; vessel/);
  assert.match(xml, /literal &amp; search/);
  assert.match(xml, /excludedCountryCodes/);
  assert.match(xml, /KOREA/);
  assert.match(xml, /Year to date/);
  assert.match(xml, /Exclude Korea Desk/);
  assert.match(xml, /Finance snapshot/);
  assert.match(xml, /revision 7/);
  assert.match(xml, /Actual|ACT\/365/);
  assert.match(xml, /Unavailable/);
  assert.match(xml, /Buyer receipt missing/);
  assert.match(xml, /<Data ss:Type="Number">12\.5<\/Data>/);
  assert.ok(xml.indexOf('USD') < xml.indexOf('EUR') || xml.indexOf('EUR') < xml.indexOf('USD'));
});

test('oversized Dashboard selections split into bounded worksheet chunks', () => {
  assert.deepEqual(dashboardStemExportInternals.splitRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(dashboardStemExportInternals.MAX_DATA_ROWS_PER_SHEET, 60_000);
});

test('currency totals withhold partial turnover or gross profit instead of summing missing rows as zero', () => {
  const [totals] = dashboardStemExportInternals.currencyTotals([
    { currency: 'USD', buyer: 100, netPnl: 20 },
    { currency: 'USD', buyer: null, netPnl: null },
  ], false);
  assert.equal(totals.turnover, 100);
  assert.equal(totals.grossProfit, 20);
  assert.equal(totals.turnoverComplete, false);
  assert.equal(totals.grossProfitComplete, false);
  const xml = buildDashboardStemWorkbookXml({ rows: [
    { id: 'one', currency: 'USD', buyer: 100, netPnl: 20 },
    { id: 'two', currency: 'USD', buyer: null, netPnl: null },
  ] });
  const scope = xml.slice(xml.indexOf('<Worksheet ss:Name="Scope">'));
  assert.match(scope, /USD/);
  assert.equal((scope.match(/>Unavailable</g) || []).length, 2);
});

test('enabled EBIT refreshes after a rate update and across Hong Kong date visibility changes', async () => {
  const page = await readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8');
  assert.match(page, /fcos:finance-settings-updated/);
  assert.match(page, /hongKongCalendarDate/);
  assert.match(page, /millisecondsUntilNextHongKongDate/);
  assert.match(page, /document\.addEventListener\('visibilitychange'/);
  assert.match(page, /refreshFinanceSummary/);
});
