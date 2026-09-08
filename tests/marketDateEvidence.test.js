import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketPulseSnapshot } from '../api/_marketPulse.js';
import { buildDatedMarketSnapshot, loadCanonicalObservations } from '../api/_marketIntelligence.js';
import { readCompletedMarketBrief } from '../api/_marketReportDates.js';
import { calcMopsAverage } from '../src/hedge/lib/domain.js';

function completeBrief(reportDate) {
  return { report_date: reportDate, revision: 1, completeness: { requiredReports: 2, completeReports: 2 }, deterministic_metrics: { curveRegimes: [] } };
}

function incompleteBrief(reportDate, revision = 1) {
  return { report_date: reportDate, revision, completeness: { requiredReports: 2, completeReports: 1 }, deterministic_metrics: { curveRegimes: [] } };
}

function historySeries() {
  return [
    { id: 'cargo-vlsfo', market_family: 'cargo', product_key: 'vlsfo', product_label: 'S0.5%', source_symbol: 'AMFSA00', unit: 'USD/MT', usd_mt_factor: 1 },
    { id: 'singapore-vlsfo', market_family: 'delivered', product_key: 'vlsfo', product_label: 'S0.5%', port_key: 'singapore', port_label: 'Singapore', source_symbol: 'DEL-SG-VLSFO', source_type: 'assessed', unit: 'USD/MT', display_order: 1 },
  ];
}

function observation(id, seriesId, priceDate, price) {
  return { id, series_id: seriesId, import_id: `import-${priceDate}`, price_date: priceDate, price, day_change: 0, quality_status: 'verified', source_page: 2 };
}

test('historical Pulse reconstructs only selected-month rows at or before the selected date', () => {
  const rows = [
    { price_date: '2026-08-03', s380: 500, s05: 600, sgo: 90, is_estimate: false },
    { price_date: '2026-08-04', s380: 510, s05: 610, sgo: 91, is_estimate: true },
    { price_date: '2026-08-12', s380: 900, s05: 999, sgo: 150, is_estimate: false },
  ];
  const pulse = buildMarketPulseSnapshot({
    currentMonthRows: rows,
    latestMopsRow: rows[2],
    latestBrief: completeBrief('2026-08-12'),
    previousBrief: completeBrief('2026-08-11'),
    month: '2026-09',
    asOfDate: '2026-08-04',
  });
  const expected = calcMopsAverage('2026-08', rows.slice(0, 2), 's380');

  assert.equal(pulse.mode, 'historical');
  assert.equal(pulse.asOfDate, '2026-08-04');
  assert.equal(pulse.currentMonth, '2026-08');
  assert.equal(pulse.latestMopsPublicationDate, '2026-08-03');
  assert.equal(pulse.products[0].latestMops.value, 500);
  assert.equal(pulse.products[0].monthlyEstimate.value, expected.avg);
  assert.equal(pulse.products[0].monthlyEstimate.mode, 'reconstructed');
  assert.equal(pulse.products[0].monthlyEstimate.actualDays, expected.actualDays);
  assert.equal(pulse.products[0].monthlyEstimate.estimatedDays, expected.estimatedDays);
  assert.equal(pulse.products[0].monthlyEstimate.carriedDays, expected.carryDays);
  assert.equal(pulse.products[0].monthlyEstimate.countedDays, expected.countedDays);
  assert.match(pulse.methodology.monthlyEstimate, /dated on or before the selected report date/);
  assert.equal(pulse.curveReportDate, null, 'future report evidence must not appear in a historical Pulse');
  assert.equal(pulse.products[0].curve.status, 'unavailable');
});

test('dated market snapshot suppresses an exact-date ledger mismatch and quarantined conflict', () => {
  const series = historySeries();
  const observations = [
    observation('cargo-1', 'cargo-vlsfo', '2026-08-04', 600),
    observation('delivered-1', 'singapore-vlsfo', '2026-08-04', 620),
  ];
  const mismatched = buildDatedMarketSnapshot(series, observations, [{ price_date: '2026-08-04', s05: 599, is_estimate: false }], [], '2026-08-04');
  const mismatchRow = mismatched.delivered[0];
  assert.equal(mismatchRow.deliveredPremium, null);
  assert.equal(mismatchRow.latestSpread, null);
  assert.equal(mismatchRow.warnings[0].code, 'MOPS_LEDGER_VALUE_MISMATCH');

  const conflicted = buildDatedMarketSnapshot(series, observations, [{ price_date: '2026-08-04', s05: 600, is_estimate: false }], [{ series_id: 'cargo-vlsfo', price_date: '2026-08-04', conflict_code: 'SOURCE_CONFLICT' }], '2026-08-04');
  const conflictRow = conflicted.delivered[0];
  assert.equal(conflictRow.deliveredPremium, null);
  assert.equal(conflictRow.latestSpread, null);
  assert.equal(conflictRow.warnings[0].code, 'SOURCE_CONFLICT');
});

test('dated market snapshot keeps zero values distinct from a missing exact-date MOPS observation', () => {
  const series = historySeries();
  const observations = [
    observation('delivered-missing', 'singapore-vlsfo', '2026-08-03', 620),
    observation('cargo-zero', 'cargo-vlsfo', '2026-08-04', 0),
    observation('delivered-zero', 'singapore-vlsfo', '2026-08-04', 0),
  ];
  const snapshot = buildDatedMarketSnapshot(series, observations, [
    { price_date: '2026-08-03', s05: 620, is_estimate: false },
    { price_date: '2026-08-04', s05: 0, is_estimate: false },
  ], [], '2026-08-04');
  const points = snapshot.delivered[0].spreadHistory;

  assert.equal(points.length, 1);
  assert.deepEqual(points[0], {
    date: '2026-08-04', delivered: 0, dayChange: 0, mops: 0, spread: 0, sourcePage: 2, suppressionReason: null,
  });
  assert.equal(snapshot.delivered[0].deliveredPremium, 0);
});

test('dated snapshot preserves configured unpublished ports without dereferencing empty evidence', () => {
  const snapshot = buildDatedMarketSnapshot(historySeries(), [], [], [], '2026-09-02');
  assert.equal(snapshot.delivered[0].latest, null);
  assert.equal(snapshot.delivered[0].deliveredPremium, null);
  assert.equal(snapshot.delivered[0].latestSpread, null);
  assert.equal(snapshot.delivered[0].horizonStats['3m'].matchedSamples, 0);
});

function canonicalClient(pages, error = null) {
  const ranges = [];
  const orders = [];
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    order: (column, options) => { orders.push([column, options]); return query; },
    range: async (from, to) => {
      ranges.push([from, to]);
      return { data: error ? [] : (pages.shift() || []), error };
    },
  };
  return { client: { from: () => query }, ranges, orders };
}

test('canonical observations page beyond 5,000 rows with stable date and id ordering', async () => {
  const pages = Array.from({ length: 5 }, (_, page) => Array.from({ length: 1000 }, (_, index) => ({ id: `${page}:${index}` }))).concat([[{ id: 'final-1' }, { id: 'final-2' }]]);
  const { client, ranges, orders } = canonicalClient(pages);
  const rows = await loadCanonicalObservations(client, ['series-a'], '2025-01-01', '2026-09-05');

  assert.equal(rows.length, 5002);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999], [5000, 5999]]);
  assert.deepEqual(orders, [['price_date', { ascending: true }], ['id', { ascending: true }], ['price_date', { ascending: true }], ['id', { ascending: true }], ['price_date', { ascending: true }], ['id', { ascending: true }], ['price_date', { ascending: true }], ['id', { ascending: true }], ['price_date', { ascending: true }], ['id', { ascending: true }], ['price_date', { ascending: true }], ['id', { ascending: true }]]);
});

test('canonical observation query errors fail closed', async () => {
  const { client } = canonicalClient([], { message: 'database unavailable' });
  await assert.rejects(
    () => loadCanonicalObservations(client, ['series-a'], '2025-01-01', '2026-09-05'),
    (error) => error.code === 'MARKET_HISTORY_LOAD_FAILED' && error.statusCode === 502,
  );
});

function completedBriefClient(rows) {
  const ranges = [];
  const filters = [];
  const orders = [];
  return {
    client: {
      from(table) {
        assert.equal(table, 'market_intelligence_briefs');
        const query = {
          select: () => query,
          gt: (column, value) => { filters.push(['gt', column, value]); return query; },
          gte: (column, value) => { filters.push(['gte', column, value]); return query; },
          lt: (column, value) => { filters.push(['lt', column, value]); return query; },
          lte: (column, value) => { filters.push(['lte', column, value]); return query; },
          order: (column, options) => { orders.push([column, options]); return query; },
          range: async (from, to) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; },
        };
        return query;
      },
    }, ranges, filters, orders,
  };
}

test('completed brief selection skips incomplete newest revisions and continues across pages', async () => {
  const firstPage = [incompleteBrief('2026-08-31', 2), completeBrief('2026-08-31')];
  while (firstPage.length < 100) firstPage.push(incompleteBrief(`2026-08-${String(30 - (firstPage.length % 30)).padStart(2, '0')}`, 1));
  const { client, ranges, filters, orders } = completedBriefClient([...firstPage, completeBrief('2026-07-01')]);
  const result = await readCompletedMarketBrief(client, '2026-08-31');

  assert.equal(result.report_date, '2026-07-01');
  assert.deepEqual(ranges, [[0, 99], [100, 199]]);
  assert.deepEqual(filters, [['lte', 'report_date', '2026-08-31'], ['lte', 'report_date', '2026-08-31']]);
  assert.deepEqual(orders, [['report_date', { ascending: false }], ['revision', { ascending: false }], ['report_date', { ascending: false }], ['revision', { ascending: false }]]);
});

test('completed brief selection applies next and previous date boundaries', async () => {
  const next = completedBriefClient([completeBrief('2026-09-03')]);
  assert.equal((await readCompletedMarketBrief(next.client, '2026-09-01', { direction: 'next', upperBound: '2026-09-05' })).report_date, '2026-09-03');
  assert.deepEqual(next.filters, [['gt', 'report_date', '2026-09-01'], ['lte', 'report_date', '2026-09-05']]);
  assert.deepEqual(next.orders, [['report_date', { ascending: true }], ['revision', { ascending: false }]]);

  const previous = completedBriefClient([completeBrief('2026-08-29')]);
  assert.equal((await readCompletedMarketBrief(previous.client, '2026-09-01', { direction: 'previous' })).report_date, '2026-08-29');
  assert.deepEqual(previous.filters, [['lt', 'report_date', '2026-09-01']]);
  assert.deepEqual(previous.orders, [['report_date', { ascending: false }], ['revision', { ascending: false }]]);
});
