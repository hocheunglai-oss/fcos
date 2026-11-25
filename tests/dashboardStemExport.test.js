import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  createDashboardStemWorkbook,
  dashboardStemExportFileName,
  dashboardStemExportPeriod,
  fetchAllDashboardStems,
} from '../src/lib/dashboardStemExport.js';

import { read, utils } from 'xlsx';
import { buildDashboardStemWorkbook, dashboardStemWorkbookInternals as dashboardStemExportInternals } from '../src/lib/dashboardStemWorkbook.js';
import { dashboardLineItemVolume, dashboardVolumeLabel } from '../api/_dashboardVolume.js';
import { dashboardExportSelectionDigest } from '../shared/dashboardExportSelection.js';
import { dashboardExportScope } from '../api/_dashboardExportScope.js';
import { dashboardDisputeCondition } from '../api/_decisionDashboard.js';

const revision = '2026-11-24T00:00:00.000Z';
const exportRow = (id, exportRevision = revision) => ({ id, exportRevision });

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
  const rows = ['one', 'two', 'three'].map(id => exportRow(id));
  const exportSelectionDigest = await dashboardExportSelectionDigest(rows);
  const pages = [
    { matchingCount: 3, stems: rows.slice(0, 2), nextCursor: 'page-two', finance, exportSelectionDigest },
    { matchingCount: 3, stems: rows.slice(2), nextCursor: null, finance },
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
  assert.ok(calls.every(call => call.payload.exportSnapshot === true));
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

test('Korea Desk include fetches finance even when the dashboard toggle is off', async () => {
  const rows = [exportRow('one')];
  const digest = await dashboardExportSelectionDigest(rows);
  let payload;
  const result = await fetchAllDashboardStems({
    filterPayload: { filters: { koreaDeskMode: 'include' } },
    includeFinanceCosts: false,
    invoke: async (_name, request) => {
      payload = request;
      return { data: { matchingCount: 1, stems: rows, nextCursor: null, exportSelectionDigest: digest, finance } };
    },
  });
  assert.equal(payload.includeFinanceCosts, true);
  assert.equal(result.finance.revision, finance.revision);
});

test('Dashboard XLS export preserves callers that do not request finance columns', async () => {
  const calls = [];
  const stems = [exportRow('one')];
  const exportSelectionDigest = await dashboardExportSelectionDigest(stems);
  const result = await fetchAllDashboardStems({
    invoke: async (_name, payload) => {
      calls.push(payload);
      return { data: { matchingCount: 1, stems, exportSelectionDigest, nextCursor: null } };
    },
  });
  assert.equal(result.finance, null);
  assert.equal('includeFinanceCosts' in calls[0], false);
  assert.equal('financeSnapshot' in calls[0], false);
});

test('Dashboard export detects same-count replacements and edits across pages', async () => {
  const initial = ['A', 'B', 'C'].map(id => exportRow(id));
  const exportSelectionDigest = await dashboardExportSelectionDigest(initial);
  const download = async (last, proof = exportSelectionDigest) => {
    let calls = 0;
    return fetchAllDashboardStems({
      pageSize: 2,
      invoke: async () => ({ data: calls++ === 0
        ? { matchingCount: 3, stems: [initial[1], initial[0]], nextCursor: 'two', exportSelectionDigest: proof }
        : { matchingCount: 3, stems: [last], nextCursor: null } }),
    });
  };
  assert.deepEqual((await download(initial[2])).rows.map(row => row.id), ['B', 'A', 'C']);
  await assert.rejects(download(exportRow('D')), /selection changed/);
  await assert.rejects(download(exportRow('C', '2026-11-24T11:00:00.000Z')), /selection changed/);
  await assert.rejects(download({ id: 'C' }), /cannot verify the STEM revision/);
  await assert.rejects(download(initial[2], null), /selection changed/);
});

test('Dashboard XLS bypasses shared result caching, refreshes schema once, and reads each data page', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const scope = source.match(/^async function loadDecisionDashboardScope\([\s\S]*?^\}/m)?.[0];
  const stemList = source.match(/^async function dashboardStemList\([\s\S]*?^\}/m)?.[0];
  assert.ok(scope && stemList);
  const rows = Array.from({ length: 1000 }, (_, i) => exportRow(String(i)));
  const digest = await dashboardExportSelectionDigest(rows);
  const metadata = new Set();
  let describes = 0;
  let pageReads = 0;
  let financeChecks = 0;
  let resultCacheCalls = 0;
  const stopAfterSchema = new Error('schema boundary');
  const [route, loader] = runInNewContext(`${scope}\n${stemList}\n[dashboardStemList, loadDecisionDashboardScope]`, {
    requestForcesRefresh: (_body, req) => req?.headers?.['x-fcos-cache-bypass'] === '1',
    normalizeDecisionDashboardFilters: () => ({}),
    salesforceObjectFields: async ({ objectName, forceRefresh }) => {
      if (forceRefresh || !metadata.has(objectName)) {
        describes++;
        metadata.add(objectName);
      }
      return { get fields() { throw stopAfterSchema; } };
    },
    dashboardFinanceContext: async () => { financeChecks++; return finance; },
    cachedDecisionDashboard: async (_section, _body, _req, _access, _ttl, load) => {
      resultCacheCalls++;
      return load();
    },
    dashboardStemListUncached: async (body, req, access) => {
      await assert.rejects(loader(body, req, access, { pageOnly: true }), error => error === stopAfterSchema);
      const start = Number(body.cursor || 0);
      const end = start + body.pageSize;
      pageReads++;
      return { stems: rows.slice(start, end), matchingCount: rows.length, finance,
        ...(start === 0 ? { exportSelectionDigest: digest } : {}),
        nextCursor: end < rows.length ? String(end) : null };
    },
  });
  const result = await fetchAllDashboardStems({
    invoke: async (_name, body, options) => ({ data: await route(body, {
      headers: { 'x-fcos-cache-bypass': options.force ? '1' : '0' },
    }) }),
    includeFinanceCosts: true,
  });
  assert.deepEqual(result.rows, rows);
  assert.deepEqual({ describes, pageReads, financeChecks, resultCacheCalls }, {
    describes: 6, pageReads: 5, financeChecks: 5, resultCacheCalls: 0,
  });
  await route({ pageSize: 50 }, { headers: { 'x-fcos-cache-bypass': '1' } });
  assert.equal(resultCacheCalls, 1);
  assert.equal(describes, 12);
});

test('the export manifest reads only IDs and revision stamps within each supplied filter', async () => {
  const scope = dashboardExportScope(new Set(['LastModifiedDate', 'SystemModstamp']));
  const queries = [];
  const queryAll = async (soql, id) => {
    queries.push(soql);
    return [{ Id: id, SystemModstamp: revision }];
  };
  const counts = await Promise.all(['B', 'A'].map(id => scope.count(
    `Status__c = 'Open' AND Id IN ('${id}')`, soql => queryAll(soql, id),
  )));
  assert.deepEqual(counts, [1, 1]);
  assert.deepEqual(queries, ['B', 'A'].map(id =>
    `SELECT Id, SystemModstamp FROM stem__c WHERE Status__c = 'Open' AND Id IN ('${id}')`));
  assert.equal(await scope.digest(), await dashboardExportSelectionDigest([exportRow('A'), exportRow('B')]));
  const empty = dashboardExportScope(new Set(['LastModifiedDate']));
  assert.equal(empty.revisionField, 'LastModifiedDate');
  const data = { stems: [], matchingCount: 0, exportSelectionDigest: await empty.digest() };
  assert.deepEqual((await fetchAllDashboardStems({ invoke: async () => ({ data }) })).rows, []);
  assert.throws(() => dashboardExportScope(new Set()), { code: 'DASHBOARD_EXPORT_REVISION_UNAVAILABLE' });
});

test('Disputed only uses the available Salesforce field and refuses an unfiltered result', () => {
  assert.equal(dashboardDisputeCondition(new Set(['Dispute_Status__c', 'Dispute__c'])),
    "Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null");
  assert.equal(dashboardDisputeCondition(new Set(['Dispute__c'])), 'Dispute__c = true');
  assert.throws(() => dashboardDisputeCondition(new Set(['Id'])), {
    status: 503, code: 'DASHBOARD_DISPUTE_FILTER_UNAVAILABLE',
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
    'Products / Quantities', 'Port', 'Country', 'Turnover', 'Gross Profit',
    'Dispute', 'Finance Cost', 'Bank Charge', 'EBIT', 'Evidence Status',
  ]);
  assert.deepEqual({ t: sheet.A2.t, v: sheet.A2.v, f: sheet.A2.f }, { t: 's', v: '=SUM(1,1) & <STEM>', f: undefined });
  assert.equal(sheet.B2.v, '2026-09-02');
  assert.equal(sheet.C2.v, 'Actual delivery');
  assert.equal(sheet.D2.v, 'A "quoted" vessel');
  assert.equal(sheet.J2.v, 1000.25);
  assert.equal(sheet.J2.t, 'n');
  assert.equal(sheet.J2.w, 'USD 1,000.25');
  assert.equal(sheet.J3.w, 'EUR 2,000.00');
  assert.equal(sheet.L2.v, 'Disputed');
  assert.equal(sheet.M2.v, 7.25);
  assert.equal(sheet.M3.v, 12.5);
  assert.equal(sheet.N2.v, 'Unavailable');
  assert.equal(sheet.N3.v, 10);
  assert.equal(sheet.O2.v, 'Unavailable');
  assert.equal(sheet.O3.v, 277.5);
  assert.match(sheet.P2.v, /Buyer receipt missing/);
  assert.match(sheet.P2.v, /Bank evidence missing/);
  assert.ok(!stemRows[0].includes('Currency'));
  assert.ok(!stemRows.flat().includes('Created Date'));
  assert.ok(!stemRows.flat().includes('Closed'));
  assert.ok(!stemRows.flat().includes('Removed dispute detail'));
  assert.deepEqual(
    buildDashboardStemWorkbook({ includeFinanceCosts: true }).Sheets.STEMs['!cols'].map(({ wch }) => wch),
    [36, 19, 19, 19, 36, 36, 36, 19, 19, 19, 19, 19, 19, 19, 19, 36],
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

test('binary XLS retains cancelled STEMs and identifies them with or without finance columns', async () => {
  const deskCases = [
    { koreaDeskMode: 'include', name: 'Cancelled Korea Desk STEM', port: 'Busan' },
    { koreaDeskMode: 'exclude', name: 'Cancelled non-Korea STEM', port: 'Singapore' },
  ];
  for (const { koreaDeskMode, name, port } of deskCases) {
    for (const includeFinanceCosts of [false, true]) {
      const blob = await createDashboardStemWorkbook({
        rows: [
          { name, status: 'Cancelled', port: { name: port }, buyer: 0, netPnl: 0, currency: 'USD',
            finance: { complete: false, status: 'missing_evidence', issues: ['No final invoice evidence'] } },
          { name: 'Active STEM', status: 'Delivered', buyer: 10, netPnl: 2, currency: 'USD' },
        ],
        filterPayload: { filters: { koreaDeskMode } },
        includeFinanceCosts,
      });
      const book = read(await blob.arrayBuffer(), { type: 'array' });
      const [headers, cancelled, active] = utils.sheet_to_json(book.Sheets.STEMs, { header: 1 });
      const evidenceIndex = headers.indexOf('Evidence Status');
      const hasFinance = includeFinanceCosts || koreaDeskMode === 'include';
      assert.equal(evidenceIndex, hasFinance ? 15 : 12);
      assert.equal(cancelled[0], name);
      assert.equal(cancelled[evidenceIndex], hasFinance
        ? 'Cancelled STEM — missing_evidence: No final invoice evidence'
        : 'Cancelled STEM');
      assert.equal(active[evidenceIndex], hasFinance ? 'Unavailable' : '');
    }
  }
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
  assert.equal(sheet.M2.v, 2);
  assert.equal(sheet.N2.v, 'Unavailable');
  assert.equal(sheet.M3.v, 'Unavailable');
  assert.equal(sheet.N3.v, 15);
  assert.equal(sheet.O2.v, 'Unavailable');
  assert.equal(sheet.O3.v, 'Unavailable');
});

test('native XLS groups all amounts and quantity ranges while retaining numeric values and currency labels', async () => {
  const blob = await createDashboardStemWorkbook({ includeFinanceCosts: true, finance,
    rows: [{ name: 'STEM-2026001', currency: 'USD', buyer: 1234567.89, netPnl: -2345.67,
      productQuantities: [{ productName: 'RMG380 (ISO2010)', quantityLabel: '1234.567 MT' }],
      supplierProductRows: [{ itemName: 'LSMGO', quantityLabel: '2500.125-3500.750 MT' }, { itemName: 'Adjustment', quantityLabel: '-1234.5678 MT' }],
      finance: { complete: true, bankChargeComplete: true, financeCost: 1234.56, bankCharge: 0, ebit: -3580.23 } }],
  });
  const book = read(await blob.arrayBuffer(), { type: 'array', cellNF: true });
  const sheet = book.Sheets.STEMs;
  assert.equal(sheet.J1.v, 'Turnover (USD)'); assert.equal(sheet.N1.v, 'Bank Charge (USD)');
  for (const [cell, value, display] of [['J2', 1234567.89, '1,234,567.89'], ['K2', -2345.67, '-2,345.67'],
    ['M2', 1234.56, '1,234.56'], ['N2', 0, '0.00'], ['O2', -3580.23, '-3,580.23']]) {
    assert.equal(sheet[cell].t, 'n'); assert.equal(sheet[cell].v, value); assert.equal(sheet[cell].w, display); assert.equal(sheet[cell].z, '#,##0.00');
  }
  assert.equal(sheet.G2.v, 'RMG380 (ISO2010); 1,234.567 MT; LSMGO; 2,500.125-3,500.750 MT; Adjustment; -1,234.5678 MT');
  assert.equal(sheet.A2.v, 'STEM-2026001');
  const scopeCells = Object.values(book.Sheets.Scope).filter((cell) => cell?.t === 'n' && cell.v === 1234567.89);
  assert.equal(scopeCells.length, 1); assert.equal(scopeCells[0].w, '1,234,567.89');
});

test('native XLS keeps package quantities in the existing product column without relabeling them as tonnes', async () => {
  const options = { lineItemUomField: 'UOM__c' };
  const packageRange = dashboardLineItemVolume({
    UOM__c: 'PAILS', Quantity__c: 2500, Quantity_Max__c: 3500, Is_Quantity_Range__c: true,
  }, false, options);
  const unavailable = dashboardLineItemVolume({ UOM__c: 'PAIL' }, false, options);
  const blob = await createDashboardStemWorkbook({ rows: [{
    name: 'STEM-2026001', currency: 'USD', buyer: 1234567.89,
    productQuantities: [{ productName: 'Lubricant', quantityLabel: dashboardVolumeLabel(packageRange) }],
    supplierProductRows: [{ itemName: 'Lubricant A', quantityLabel: dashboardVolumeLabel(unavailable) }],
  }] });
  const sheet = read(await blob.arrayBuffer(), { type: 'array', cellNF: true }).Sheets.STEMs;
  assert.equal(sheet.G2.v, 'Lubricant; 2,500-3,500 PAILS; Lubricant A; Unavailable PAIL');
  assert.equal(sheet.J1.v, 'Turnover (USD)');
  assert.equal(sheet.J2.v, 1234567.89);
  assert.equal(sheet.J2.w, '1,234,567.89');
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
  const filterPayload = { dateWindows: halfYear, filters: { koreaDeskMode: 'include' } };
  assert.equal(dashboardStemExportFileName({ filterPayload }), 'FCOS_Dashboard_STEMs_2026-01-01_to_2026-06-30_Korea_Desk.xls');
  assert.equal(dashboardStemExportPeriod(filterPayload), '2026-01-01 to 2026-06-30');
  const blob = await createDashboardStemWorkbook({ filterPayload, scopeLabels: { period: 'custom' } });
  const scope = utils.sheet_to_json(read(await blob.arrayBuffer(), { type: 'array' }).Sheets.Scope, { header: 1 });
  assert.equal(Object.fromEntries(scope).Period, '2026-01-01 to 2026-06-30');
  assert.match(dashboardStemExportFileName({ filterPayload: { ...filterPayload, filters: { koreaDeskMode: 'exclude' }, disputeOnly: true } }), /Exclude_Korea_Desk_Disputed_only\.xls$/);
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
  const short = ['한국 선박 船舶', '=1+1', '+SUM(1,1)', '-1+1', '@SUM(1,1)', '<tag>&"quoted"', '韓'.repeat(255)];
  for (const names of [short, [...short, '韓'.repeat(256), '韓'.repeat(4000)]]) {
    const blob = await createDashboardStemWorkbook({ rows: names.map(name => ({ name })) });
    const book = read(await blob.arrayBuffer(), { type: 'array' });
    names.forEach((name, index) => {
      const cell = book.Sheets.STEMs[`A${index + 2}`];
      assert.equal(cell.v, name);
      assert.equal(cell.t, 's');
      assert.equal(cell.f, undefined);
    });
  }
  await assert.rejects(createDashboardStemWorkbook({ rows: [{ name: 'a'.repeat(4001) }] }), /exceeds the supported XLS limit/);
});

test('native XLS exports more than the legacy worksheet row limit without dropping records', async () => {
  const rows = Array.from({ length: 65_537 }, (_, index) => ({ name: `STEM-${index}`, currency: 'USD', buyer: 1, netPnl: 0 }));
  const blob = await createDashboardStemWorkbook({ rows });
  const book = read(await blob.arrayBuffer(), { type: 'array' });
  assert.deepEqual(book.SheetNames, ['STEMs 1', 'STEMs 2', 'Scope']);
  let nextStem = 0;
  for (const [name, count] of [['STEMs 1', 60_000], ['STEMs 2', 5537]]) {
    const sheet = book.Sheets[name];
    const bounds = utils.decode_range(sheet['!ref']);
    assert.equal(bounds.s.r, 0);
    assert.equal(bounds.e.r, count);
    for (let row = 2; row <= count + 1; row++) {
      assert.equal(sheet[`A${row}`]?.v, `STEM-${nextStem++}`);
    }
  }
  assert.equal(nextStem, 65_537);
  assert.equal(Object.fromEntries(utils.sheet_to_json(book.Sheets.Scope, { header: 1 }))['Exported STEM rows'], '65537');
});
