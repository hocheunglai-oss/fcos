import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDashboardStemWorkbook,
  dashboardStemExportFileName,
  dashboardStemExportPeriod,
  fetchAllDashboardStems,
} from '../src/lib/dashboardStemExport.js';

import { read, utils } from 'xlsx';
import { buildDashboardStemWorkbook, dashboardStemWorkbookInternals as dashboardStemExportInternals } from '../src/lib/dashboardStemWorkbook.js';

const finance = {
  annualInterestRatePct: 5,
  bankChargesUsd: { UBS: 10, DBS: 15 },
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
  assert.deepEqual(calls[1].payload.financeSnapshot, {
    annualInterestRatePct: 5,
    bankChargesUsd: { DBS: 15, UBS: 10 },
    revision: 7,
    asOfDate: '2026-09-20',
  });
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

  await t.test('bank charge schedule drift with the same revision', async () => {
    let page = 0;
    await assert.rejects(fetchAllDashboardStems({
      invoke: async () => ({ data: page++ === 0
        ? { matchingCount: 2, stems: [{ id: 'one', finance: { complete: true } }], nextCursor: 'next', finance }
        : { matchingCount: 2, stems: [{ id: 'two', finance: { complete: true } }], nextCursor: null, finance: { ...finance, bankChargesUsd: { UBS: 11, DBS: 15 } } } }),
      pageSize: 1,
      includeFinanceCosts: true,
    }), /finance methodology changed/);
  });
});

test('Dashboard XLS export preserves callers that do not request finance columns', async () => {
  const calls = [];
  const result = await fetchAllDashboardStems({
    invoke: async (_name, payload) => {
      calls.push(payload);
      return { data: { matchingCount: 1, stems: [{ id: 'one' }], nextCursor: null } };
    },
  });
  assert.equal(result.finance, null);
  assert.equal('includeFinanceCosts' in calls[0], false);
  assert.equal('financeSnapshot' in calls[0], false);
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

test('binary XLS contains visible STEM and Scope sheets, literal text, numeric amounts and unavailable evidence', async () => {
  const blob = await createDashboardStemWorkbook({
    rows: [{
      id: 'one',
      name: '=SUM(1,1) & <STEM>',
      createdDate: '2026-09-01',
      deliveryDate: '2026-09-02',
      deliveryDateSource: 'delivery',
      vessel: { name: 'A "quoted" vessel' },
      account: { name: 'Buyer' },
      supplierNames: ['Supplier A'],
      productQuantities: [{ productName: 'VLSFO', quantityLabel: '100 MT' }],
      port: { name: 'Busan', countryCode: 'KOREA' },
      currency: 'USD',
      buyer: 1000.25,
      netPnl: 100.5,
      status: 'Closed',
      disputeStatus: 'Disputed',
      disputeInformation: 'Removed dispute detail',
      finance: { complete: false, financeCost: 7.25, bankCharge: null, bankChargeUsd: null, bankChargeComplete: false, bankChargeIssues: ['Bank evidence missing'], ebit: null, status: 'missing_evidence', issues: ['Buyer receipt missing'] },
    }, {
      id: 'two', name: 'Second', currency: 'EUR', buyer: 2000, netPnl: 300,
      finance: { complete: true, financeCost: 12.5, bankCharge: 10, bankChargeUsd: 10, bankChargeComplete: true, bankChargeIssues: [], ebit: 277.5, status: 'complete', issues: [] },
    }],
    filterPayload: { disputeOnly: true, filters: { countryCodes: [], excludedCountryCodes: ['KOREA'] } },
    scopeLabels: { period: 'Year to date', counterparty: 'Buyer A', port: 'Busan', country: 'All', koreaDesk: 'Exclude Korea Desk' },
    search: 'literal & search',
    sort: { field: 'deliveryDate', direction: 'desc' },
    includeFinanceCosts: true,
    finance: { ...finance, complete: false, warnings: ['One <warning>'] },
    generatedAt: '2026-09-20T01:02:03.000Z',
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const book = read(bytes, { type: 'array' });
  assert.deepEqual(book.SheetNames, ['STEMs', 'Scope']);
  const sheet = book.Sheets.STEMs;
  const stemRows = utils.sheet_to_json(sheet, { header: 1 });
  assert.equal(stemRows.length, 3);
  assert.deepEqual(stemRows[0], [
    'STEM', 'Delivery / Expected Date', 'Date Source', 'Vessel', 'Buyer', 'Suppliers',
    'Products / Quantities', 'Port', 'Country', 'Currency', 'Turnover', 'Gross Profit',
    'Dispute', 'Finance Cost', 'Bank Charge', 'EBIT', 'Evidence Status',
  ]);
  assert.deepEqual({ t: sheet.A2.t, v: sheet.A2.v, f: sheet.A2.f }, { t: 's', v: '=SUM(1,1) & <STEM>', f: undefined });
  assert.equal(sheet.B2.v, '2026-09-02');
  assert.equal(sheet.C2.v, 'Actual delivery');
  assert.equal(sheet.D2.v, 'A "quoted" vessel');
  assert.equal(sheet.K2.v, 1000.25);
  assert.equal(sheet.K2.t, 'n');
  assert.equal(sheet.M2.v, 'Disputed');
  assert.equal(sheet.N2.v, 7.25);
  assert.equal(sheet.N3.v, 12.5);
  assert.equal(sheet.O2.v, 'Unavailable');
  assert.equal(sheet.O3.v, 10);
  assert.equal(sheet.P2.v, 'Unavailable');
  assert.equal(sheet.P3.v, 277.5);
  assert.match(sheet.Q2.v, /Buyer receipt missing/);
  assert.match(sheet.Q2.v, /Bank evidence missing/);
  assert.ok(!stemRows.flat().includes('Created Date'));
  assert.ok(!stemRows.flat().includes('Closed'));
  assert.ok(!stemRows.flat().includes('Removed dispute detail'));
  assert.deepEqual(
    buildDashboardStemWorkbook({ includeFinanceCosts: true }).Sheets.STEMs['!cols'].map(({ wch }) => wch),
    [36, 19, 19, 19, 36, 36, 36, 19, 19, 19, 19, 19, 19, 19, 19, 19, 36],
  );
  assert.ok(!book.Workbook.Sheets.some((item) => item.Hidden));
  const scope = utils.sheet_to_json(book.Sheets.Scope, { header: 1 });
  const entries = Object.fromEntries(scope);
  assert.equal(entries['Exported STEM rows'], '2');
  assert.equal(entries['Submitted text search'], 'literal & search');
  assert.equal(entries['Korea Desk'], 'Exclude Korea Desk');
  assert.match(entries['Finance snapshot'], /revision 7/);
  assert.match(entries['Bank charge snapshot'], /DBS USD 15 per remittance; UBS USD 10 per remittance/);
  assert.equal(entries['Finance warnings'], 'One <warning>');
  assert.ok(scope.some((row) => row[0] === 'USD'));
  assert.ok(scope.some((row) => row[0] === 'EUR'));
});

test('oversized Dashboard selections split into bounded worksheet chunks', () => {
  assert.deepEqual(dashboardStemExportInternals.splitRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(dashboardStemExportInternals.MAX_DATA_ROWS_PER_SHEET, 60_000);
});

test('XLS finance and bank charge cells follow their own evidence states', () => {
  const sheet = buildDashboardStemWorkbook({
    includeFinanceCosts: true,
    rows: [
      { finance: { complete: false, financeCost: 2, bankCharge: null, bankChargeComplete: false, ebit: null } },
      { finance: { complete: false, financeCost: null, bankCharge: 15, bankChargeComplete: true, ebit: null } },
    ],
  }).Sheets.STEMs;
  assert.equal(sheet.N2.v, 2);
  assert.equal(sheet.O2.v, 'Unavailable');
  assert.equal(sheet.N3.v, 'Unavailable');
  assert.equal(sheet.O3.v, 15);
  assert.equal(sheet.P2.v, 'Unavailable');
  assert.equal(sheet.P3.v, 'Unavailable');
});

test('XLS currency summaries label verified subsets without including profit from missing-evidence STEMs', () => {
  const rows = [
    { currency: 'USD', netPnl: 300, buyer: 1000, finance: { complete: true, financeCost: 12.5, bankCharge: 10, bankChargeComplete: true, ebit: 277.5 } },
    { currency: 'USD', netPnl: 100, buyer: 200, finance: { complete: false, financeCost: 2, bankCharge: null, bankChargeComplete: false, ebit: null } },
    { currency: 'EUR', netPnl: 90, buyer: 150, finance: { complete: false } },
  ];
  const [eur, usd] = dashboardStemExportInternals.currencyTotals(rows, true);
  assert.equal(usd.financeComplete, false); assert.equal(usd.rowCount, 2); assert.equal(usd.verifiedStemCount, 1);
  assert.equal(usd.grossProfit, 400); assert.equal(usd.verifiedGrossProfit, 300);
  assert.equal(usd.financeCost, 12.5); assert.equal(usd.bankCharge, 10); assert.equal(usd.ebit, 277.5); assert.equal(eur.verifiedStemCount, 0);
  const scope = utils.sheet_to_json(buildDashboardStemWorkbook({ rows, includeFinanceCosts: true, finance }).Sheets.Scope, { header: 1 });
  assert.ok(scope.some((row) => row.includes('Verified STEMs') && row.includes('Verified Bank Charge') && row.includes('Verified EBIT')));
  const usdRow = scope.find((row) => row[0] === 'USD');
  assert.equal(usdRow[7], 10);
  assert.equal(usdRow[8], 277.5);
  const eurRow = scope.find((row) => row[0] === 'EUR');
  assert.equal(eurRow[7], 'Unavailable');
  assert.equal(eurRow[8], 'Unavailable');
  assert.match(Object.fromEntries(scope)['Missing-data note'], /Unknown costs are never zero/);
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
  const book = buildDashboardStemWorkbook({ rows: [
    { id: 'one', currency: 'USD', buyer: 100, netPnl: 20 },
    { id: 'two', currency: 'USD', buyer: null, netPnl: null },
  ] });
  const scope = utils.sheet_to_json(book.Sheets.Scope, { header: 1 });
  assert.deepEqual(scope.find((row) => row[0] === 'USD'), ['USD', 2, 'Unavailable', 'Unavailable']);
});

test('enabled EBIT refreshes after a rate update and across Hong Kong date visibility changes', async () => {
  const page = await readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8');
  assert.match(page, /fcos:finance-settings-updated/);
  assert.match(page, /hongKongCalendarDate/);
  assert.match(page, /millisecondsUntilNextHongKongDate/);
  assert.match(page, /document\.addEventListener\('visibilitychange'/);
  assert.match(page, /refreshFinanceSummary/);
});

const halfYear = [1, 2, 3, 4, 5, 6].map((month) => ({ startDate: `2026-${String(month).padStart(2, '0')}-01`, endDate: new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10) }));

test('export filenames use selected delivery windows and active desk labels instead of generation date', async () => {
  const filterPayload = { dateWindows: halfYear, filters: { countryCodes: ['KOREA'] } };
  assert.equal(dashboardStemExportFileName({ filterPayload }), 'FCOS_Dashboard_STEMs_2026-01-01_to_2026-06-30_Korea_Desk.xls');
  assert.equal(dashboardStemExportPeriod(filterPayload), '2026-01-01 to 2026-06-30');
  const blob = await createDashboardStemWorkbook({ filterPayload, scopeLabels: { period: 'custom' } });
  const scope = utils.sheet_to_json(read(await blob.arrayBuffer(), { type: 'array' }).Sheets.Scope, { header: 1 });
  assert.equal(Object.fromEntries(scope).Period, '2026-01-01 to 2026-06-30');
  assert.match(dashboardStemExportFileName({ filterPayload: { ...filterPayload, filters: { excludedCountryCodes: ['KOREA'] }, disputeOnly: true } }), /Exclude_Korea_Desk_Disputed_only\.xls$/);
  assert.match(dashboardStemExportFileName({ filterPayload, scopeLabels: { counterparty: 'A/B: <buyer>?*' } }), /Korea_Desk_AB_buyer\.xls$/);
});

test('discontinuous delivery periods stay explicit and filename lengths remain safe', () => {
  assert.equal(dashboardStemExportPeriod({ dateWindows: [halfYear[2], halfYear[0]] }), '2026-01-01 to 2026-01-31; 2026-03-01 to 2026-03-31');
  assert.match(dashboardStemExportFileName({ filterPayload: { dateWindows: [halfYear[0], halfYear[2]] } }), /2026-01-31_and_2026-03-01/);
  assert.match(dashboardStemExportFileName({}), /All_delivery_dates\.xls$/);
  assert.ok(Buffer.byteLength(dashboardStemExportFileName({ scopeLabels: { counterparty: '韓'.repeat(100) } })) <= 244);
  assert.throws(() => dashboardStemExportFileName({ filterPayload: { dateWindows: [{ startDate: '2026-02-30', endDate: '2026-03-10' }] } }), /invalid delivery period/);
});

test('native XLS preserves Unicode and formula-like text without executing or silently truncating it', async () => {
  const names = ['한국 선박 船舶', '=1+1', '+SUM(1,1)', '-1+1', '@SUM(1,1)', '<tag>&"quoted"', '韓'.repeat(4000)];
  const blob = await createDashboardStemWorkbook({ rows: names.map((name) => ({ name })) });
  const book = read(await blob.arrayBuffer(), { type: 'array' });
  names.forEach((name, index) => {
    const cell = book.Sheets.STEMs[`A${index + 2}`];
    assert.equal(cell.v, name); assert.equal(cell.t, 's'); assert.equal(cell.f, undefined);
  });
  await assert.rejects(createDashboardStemWorkbook({ rows: [{ name: 'a'.repeat(4001) }] }), /exceeds the supported XLS limit/);
});

test('native XLS exports more than the legacy worksheet row limit without dropping records', async () => {
  const rows = Array.from({ length: 65_537 }, (_, index) => ({ name: `STEM-${index}`, currency: 'USD', buyer: 1, netPnl: 0 }));
  const blob = await createDashboardStemWorkbook({ rows });
  const book = read(await blob.arrayBuffer(), { type: 'array' });
  assert.deepEqual(book.SheetNames, ['STEMs 1', 'STEMs 2', 'Scope']);
  const first = utils.sheet_to_json(book.Sheets['STEMs 1'], { header: 1 });
  const second = utils.sheet_to_json(book.Sheets['STEMs 2'], { header: 1 });
  assert.equal(first.length - 1, 60_000); assert.equal(second.length - 1, 5537);
  assert.equal(first[1][0], 'STEM-0'); assert.equal(second.at(-1)[0], 'STEM-65536');
  assert.equal(Object.fromEntries(utils.sheet_to_json(book.Sheets.Scope, { header: 1 }))['Exported STEM rows'], '65537');
});
