import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildMarketPulseSnapshot } from '../api/_marketPulse.js';
import { calcMopsAverage } from '../src/hedge/lib/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Market Pulse uses the exact Markets current-month average and same-snapshot curve signs', () => {
  const rows = [
    { price_date: '2026-08-03', s380: 500, s05: 600, sgo: 90, is_estimate: false },
    { price_date: '2026-08-04', s380: 510, s05: 610, sgo: 92, is_estimate: false },
  ];
  const brief = {
    report_date: '2026-08-04',
    completeness: {
      completeReports: 2,
      requiredReports: 2,
      curveEvidenceComplete: true,
      numericCurveMarks: 8,
      requiredCurveMarks: 8,
      publishedNaCount: 0,
      missingCurveMarkCount: 0,
    },
    deterministic_metrics: {
      curveRegimes: [
        { productKey: 'hsfo380', regime: 'backwardation', m1M2: 4.5, unit: 'USD/MT', reportDate: '2026-08-04' },
        { productKey: 'vlsfo', regime: 'contango', bmM1: -2, m1M2: -1, unit: 'USD/MT', reportDate: '2026-08-04' },
        { productKey: 'lsmgo', regime: 'mixed', bmM1: 1.2, m1M2: -0.4, unit: 'USD/BBL', reportDate: '2026-08-04' },
      ],
      warnings: [],
    },
  };
  const previousBrief = {
    report_date: '2026-08-03',
    completeness: {
      completeReports: 2,
      requiredReports: 2,
    },
    deterministic_metrics: {
      curveRegimes: [
        { productKey: 'hsfo380', regime: 'backwardation', m1M2: 3, unit: 'USD/MT', reportDate: '2026-08-03' },
        { productKey: 'vlsfo', regime: 'contango', bmM1: -3, m1M2: -0.5, unit: 'USD/MT', reportDate: '2026-08-03' },
        { productKey: 'lsmgo', regime: 'backwardation', bmM1: 1, m1M2: 0.2, unit: 'USD/BBL', reportDate: '2026-08-03' },
      ],
    },
  };
  const pulse = buildMarketPulseSnapshot({
    currentMonthRows: rows,
    latestMopsRow: rows[1],
    previousMopsRow: rows[0],
    latestBrief: brief,
    previousBrief,
    month: '2026-08',
  });
  const expectedS380 = calcMopsAverage('2026-08', rows, 's380');
  const expectedS05 = calcMopsAverage('2026-08', rows, 's05');
  const expectedSgo = calcMopsAverage('2026-08', rows, 'sgo');

  assert.equal(pulse.products[0].monthlyEstimate.value, expectedS380.avg);
  assert.equal(pulse.products[1].monthlyEstimate.value, expectedS05.avg);
  assert.equal(pulse.products[2].monthlyEstimate.value, expectedSgo.avg);
  assert.deepEqual(pulse.products.map((row) => row.curve.status), ['backwardation', 'contango', 'mixed']);
  assert.equal(pulse.products[0].curve.spreads[0].value, 4.5);
  assert.equal(pulse.products[0].latestMops.comparison.change, 10);
  assert.equal(pulse.products[0].latestMops.comparison.previousDate, '2026-08-03');
  assert.equal(pulse.products[0].curve.spreads[0].comparison.change, 1.5);
  assert.equal(pulse.products[1].curve.spreads[0].value, -2);
  assert.equal(pulse.products[1].curve.spreads[0].comparison.change, 1);
  assert.equal(pulse.products[1].curve.spreads[1].comparison.change, -0.5);
  assert.equal(pulse.products[2].unit, 'USD/BBL');
  assert.equal(pulse.complete, true);
});

test('Market Pulse keeps zero changes neutral and suppresses curve deltas for an incomplete adjacent pair', () => {
  const currentBrief = {
    report_date: '2026-08-04',
    completeness: { completeReports: 2, requiredReports: 2 },
    deterministic_metrics: {
      curveRegimes: [{ productKey: 'hsfo380', regime: 'flat', m1M2: 4, unit: 'USD/MT', reportDate: '2026-08-04' }],
    },
  };
  const incompletePreviousBrief = {
    report_date: '2026-08-03',
    completeness: { completeReports: 1, requiredReports: 2 },
    deterministic_metrics: {
      curveRegimes: [{ productKey: 'hsfo380', regime: 'flat', m1M2: 4, unit: 'USD/MT', reportDate: '2026-08-03' }],
    },
  };
  const pulse = buildMarketPulseSnapshot({
    latestMopsRow: { price_date: '2026-08-04', s380: 500, s05: 600, sgo: 90, is_estimate: false },
    previousMopsRow: { price_date: '2026-08-03', s380: 500, s05: 600, sgo: 90, is_estimate: false },
    latestBrief: currentBrief,
    previousBrief: incompletePreviousBrief,
    month: '2026-08',
  });

  assert.equal(pulse.products[0].latestMops.comparison.available, true);
  assert.equal(pulse.products[0].latestMops.comparison.change, 0);
  assert.equal(pulse.products[0].curve.spreads[0].comparison.available, false);
  assert.equal(pulse.products[0].curve.spreads[0].comparison.previousValue, null);
});

test('Market Pulse keeps absent curve evidence unavailable and exposes product names before codes', () => {
  const pulse = buildMarketPulseSnapshot({
    currentMonthRows: [],
    latestMopsRow: null,
    latestBrief: null,
    month: '2026-08',
  });
  assert.equal(pulse.products[0].productName, 'HSFO 380 MOPS');
  assert.equal(pulse.products[0].sourceCode, 'PPXDK00');
  assert.equal(pulse.products[0].curve.status, 'unavailable');
  assert.equal(pulse.products[0].curve.spreads[0].value, null);
  assert.equal(pulse.products[0].latestMops.comparison.available, false);
  assert.equal(pulse.products[0].curve.spreads[0].comparison.available, false);
  assert.equal(pulse.complete, false);
  assert.match(pulse.warnings.join(' '), /No MOPS publication/);
  assert.match(pulse.warnings.join(' '), /No completed Bunkerwire/);
});

test('Market Pulse handler, permissions and caching are wired without a Brent provider', () => {
  const handler = read('api/functions/[name].js');
  const policy = read('api/_handlerPolicyRegistry.js');
  const api = read('api/_marketPulse.js');
  const client = read('src/hedge/api/marketData.js');
  const layout = read('src/components/Layout.jsx');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');

  assert.match(handler, /marketPulseSnapshot: \['markets'\]/);
  assert.match(handler, /async function marketPulseSnapshot/);
  assert.match(policy, /marketPulseSnapshot: readPolicy\(\{"cache":"server"/);
  assert.match(api, /ttlSeconds: 60/);
  assert.match(api, /version: '3'/);
  assert.match(api, /previousMopsRow/);
  assert.match(api, /previousBrief/);
  assert.match(api, /tags: \['markets', 'hedge:markets', 'market:intelligence', 'market:pulse'\]/);
  assert.match(handler, /expireRuntimeCacheTags\(\['markets', 'hedge:markets', 'market:intelligence', 'market:pulse'\]\)/);
  assert.match(client, /requestMarketIntelligence\('marketPulseSnapshot'/);
  assert.match(layout, /hasModuleAccess\('markets'\)/);
  assert.equal((layout.match(/<MarketPulse\b/g) || []).length, 1);
  assert.match(layout, /app-market-pulse-dock/);
  assert.match(layout, /app-workspace-main flex h-screen/);
  assert.match(layout, /pageOwnsScroll \? 'overflow-hidden' : 'overflow-auto'/);
  assert.match(layout, /env\(safe-area-inset-top\)/);
  assert.match(pulse, /Open Markets/);
  assert.match(pulse, /No prior comparison/);
  assert.match(pulse, /align="end" side="bottom"/);
  assert.match(pulse, /max-h-\[calc\(100dvh-72px\)\]/);
  assert.doesNotMatch(pulse, /window\.location\.reload|window\.location\.replace/);
  assert.doesNotMatch(api, /brent|tradingview/i);
  assert.doesNotMatch(layout, /MarketShellBar|BRN1/i);
  assert.doesNotMatch(pulse, /brent|tradingview/i);
});
