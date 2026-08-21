import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildMarketPulseSnapshot } from '../api/_marketPulse.js';
import { calcMopsAverage } from '../src/hedge/lib/domain.js';
import {
  licensedBrentSnapshot,
  singaporePricingDay,
  tradingViewIndicativeBrent,
} from '../shared/brentMarketModel.js';

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
  const pulse = buildMarketPulseSnapshot({ currentMonthRows: rows, latestMopsRow: rows[1], latestBrief: brief, month: '2026-08' });
  const expectedS380 = calcMopsAverage('2026-08', rows, 's380');
  const expectedS05 = calcMopsAverage('2026-08', rows, 's05');
  const expectedSgo = calcMopsAverage('2026-08', rows, 'sgo');

  assert.equal(pulse.products[0].monthlyEstimate.value, expectedS380.avg);
  assert.equal(pulse.products[1].monthlyEstimate.value, expectedS05.avg);
  assert.equal(pulse.products[2].monthlyEstimate.value, expectedSgo.avg);
  assert.deepEqual(pulse.products.map((row) => row.curve.status), ['backwardation', 'contango', 'mixed']);
  assert.equal(pulse.products[0].curve.spreads[0].value, 4.5);
  assert.equal(pulse.products[1].curve.spreads[0].value, -2);
  assert.equal(pulse.products[2].unit, 'USD/BBL');
  assert.equal(pulse.complete, true);
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
  assert.equal(pulse.complete, false);
  assert.match(pulse.warnings.join(' '), /No MOPS publication/);
  assert.match(pulse.warnings.join(' '), /No completed Bunkerwire/);
});

test('interim Brent contract fails closed when TradingView cannot embed the exact ICE symbol', () => {
  const brent = tradingViewIndicativeBrent();
  assert.equal(brent.mode, 'unavailable');
  assert.equal(brent.attemptedMode, 'tradingview_indicative');
  assert.equal(brent.symbol, 'ICEEUR:BRN1!');
  assert.equal(brent.followsSingaporeCutoff, false);
  assert.equal(brent.quote, null);
  assert.deepEqual(brent.intradayPoints, []);
  assert.match(brent.disclosure, /provider delay may apply/i);
});

test('Singapore pricing days end at 16:30 and skip non-pricing days supplied by the licensed provider calendar', () => {
  const eligible = ['2026-08-20', '2026-08-21', '2026-08-24'];
  assert.equal(singaporePricingDay('2026-08-21T08:30:00.000Z', eligible), '2026-08-21');
  assert.equal(singaporePricingDay('2026-08-21T08:31:00.000Z', eligible), '2026-08-24');
  assert.equal(singaporePricingDay('2026-08-22T04:00:00.000Z', eligible), '2026-08-24');
  assert.equal(singaporePricingDay('2026-08-21T08:30:00.000Z', []), null);
});

test('future licensed Brent adapter fails closed for rights and staleness, and marks contract rolls', () => {
  const base = {
    entitlementVerified: true,
    rights: { internalDisplay: true, history: true },
    provider: 'Authorized feed',
    activeContract: 'BRNU26',
    unit: 'USD/BBL',
    quote: 72.5,
    quoteAt: '2026-08-21T08:30:00.000Z',
    intradayPoints: [
      { timestamp: '2026-08-20T08:30:00.000Z', value: 71, contract: 'BRNQ26' },
      { timestamp: '2026-08-21T08:30:00.000Z', value: 72.5, contract: 'BRNU26' },
    ],
  };
  const options = {
    now: new Date('2026-08-21T08:30:30.000Z'),
    eligiblePricingDates: ['2026-08-20', '2026-08-21', '2026-08-24'],
  };
  assert.equal(licensedBrentSnapshot({ ...base, entitlementVerified: false }, options).mode, 'unavailable');
  assert.equal(licensedBrentSnapshot({ ...base, quoteAt: '2026-08-21T08:00:00.000Z' }, options).mode, 'unavailable');
  const live = licensedBrentSnapshot(base, options);
  assert.equal(live.mode, 'licensed_live');
  assert.equal(live.change, 1.5);
  assert.deepEqual(live.rollMarkers, [{
    timestamp: '2026-08-21T08:30:00.000Z',
    fromContract: 'BRNQ26',
    toContract: 'BRNU26',
  }]);
});

test('Market Pulse handler, permissions, caching and isolated TradingView UI are wired', () => {
  const handler = read('api/functions/[name].js');
  const policy = read('api/_handlerPolicyRegistry.js');
  const api = read('api/_marketPulse.js');
  const client = read('src/hedge/api/marketData.js');
  const layout = read('src/components/Layout.jsx');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  const widget = read('src/components/market-pulse/TradingViewBrentWidget.jsx');
  const brentModel = read('shared/brentMarketModel.js');

  assert.match(handler, /marketPulseSnapshot: \['markets'\]/);
  assert.match(handler, /async function marketPulseSnapshot/);
  assert.match(policy, /marketPulseSnapshot: readPolicy\(\{"cache":"server"/);
  assert.match(api, /ttlSeconds: 60/);
  assert.match(api, /tags: \['markets', 'hedge:markets', 'market:intelligence', 'market:pulse'\]/);
  assert.match(handler, /expireRuntimeCacheTags\(\['markets', 'hedge:markets', 'market:intelligence', 'market:pulse'\]\)/);
  assert.match(client, /requestMarketIntelligence\('marketPulseSnapshot'/);
  assert.match(layout, /hasModuleAccess\('markets'\)/);
  assert.match(layout, /<MarketShellBar/);
  assert.match(pulse, /Open Markets/);
  assert.doesNotMatch(pulse, /window\.location\.reload|window\.location\.replace/);
  assert.match(brentModel, /ICEEUR:BRN1!/);
  assert.match(widget, /TRADINGVIEW_BRENT_SYMBOL/);
  assert.match(widget, /Indicative · provider delay may apply/);
  assert.match(widget, /not permitted in TradingView website widgets/);
  assert.match(widget, /Not used by FCOS calculations/);
  assert.match(widget, /https:\/\/www\.tradingview\.com\/symbols\/ICEEUR-BRN1!/);
  assert.doesNotMatch(widget, /fetch\(|appClient|localStorage|document\.createElement/);
});
