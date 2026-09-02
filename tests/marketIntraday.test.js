import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { marketIntradayInternals, parseMarketIntradayText, previewMarketIntradaySnapshot } from '../api/_marketIntraday.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const TEST_ENV = { SUPABASE_SERVICE_ROLE_KEY: 'test-only-market-intraday-preview-secret-value' };

test('21 August MOC text extracts configured products and discards 180 CST', () => {
  const preview = parseMarketIntradayText(`
8/21 MOC for reference
Sep 180 582.00 -3.75
Sep 380 575.00 -5.00
Sep 0.5% 694.10 0.60
Sep SGO 158.94 0.03
Oct brent 93.19 -0.59
`, { receivedAt: '2026-08-21T17:00:00+08:00' });

  assert.equal(preview.marketDate, '2026-08-21');
  assert.deepEqual(preview.observations.map((row) => [row.productKey, row.contractMonth, row.price, row.reportedChange, row.unit]), [
    ['hsfo380', '2026-09-01', 575, -5, 'USD/MT'],
    ['vlsfo', '2026-09-01', 694.1, 0.6, 'USD/MT'],
    ['lsmgo', '2026-09-01', 158.94, 0.03, 'USD/BBL'],
    ['brent', '2026-10-01', 93.19, -0.59, 'USD/BBL'],
  ]);
  assert.equal(preview.ignoredRows.length, 1);
  assert.equal(preview.ignoredRows[0].label, '180 CST');
  assert.equal(preview.observations.some((row) => String(row.productKey).includes('180')), false);
});

test('morning vision preview is store:false, reviewed, source-hashed and excludes 180 CST', async () => {
  const extracted = {
    marketDateText: '19-Aug',
    observations: [
      { sourceLabel: 'Brent', productKey: 'brent', quoteState: 'last_close', contractMonthText: 'Oct-26', priceText: '91.02', reportedChangeText: '+0.15', unit: 'USD/BBL' },
      { sourceLabel: 'ICE Gasoil', productKey: 'ice_gasoil', quoteState: 'last_close', contractMonthText: 'Sep-26', priceText: '1299', reportedChangeText: '+19.75', unit: 'USD/MT' },
      { sourceLabel: '380cst', productKey: 'hsfo380', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '578.50', reportedChangeText: '+10.60', unit: 'USD/MT' },
      { sourceLabel: '380cst', productKey: 'hsfo380', quoteState: 'current_indication', contractMonthText: 'Oct-26', priceText: '539.00', reportedChangeText: '+10.85', unit: 'USD/MT' },
      { sourceLabel: 'M0.5%', productKey: 'vlsfo', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '691.25', reportedChangeText: '+7.76', unit: 'USD/MT' },
      { sourceLabel: 'M0.5%', productKey: 'vlsfo', quoteState: 'current_indication', contractMonthText: 'Oct-26', priceText: '656.75', reportedChangeText: '+9.01', unit: 'USD/MT' },
      { sourceLabel: 'GO 10ppm', productKey: 'lsmgo', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '162.46', reportedChangeText: '+3.46', unit: 'USD/BBL' },
      { sourceLabel: 'GO 10ppm', productKey: 'lsmgo', quoteState: 'current_indication', contractMonthText: 'Oct-26', priceText: '155.81', reportedChangeText: '+3.51', unit: 'USD/BBL' },
      { sourceLabel: 'Brent', productKey: 'brent', quoteState: 'current_indication', contractMonthText: 'Oct-26', priceText: '91.93', reportedChangeText: '+0.91', unit: 'USD/BBL' },
      { sourceLabel: 'ICE Gasoil', productKey: 'ice_gasoil', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '1314.5', reportedChangeText: '+15.50', unit: 'USD/MT' },
    ],
    ignoredRows: [{ label: '180 CST', reason: 'Configured to ignore' }],
    warnings: [],
  };
  let requestBody;
  const result = await previewMarketIntradaySnapshot({ id: 'actor', email: 'markets@example.test' }, {
    sourceType: 'morning_indication',
    receivedAt: '2026-08-19T09:15:00+08:00',
    mimeType: 'image/png',
    imageBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64'),
  }, {
    apiKey: 'test-key', env: TEST_ENV,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify(extracted) }) };
    },
  });

  assert.equal(requestBody.store, false);
  assert.equal(requestBody.input[1].content[0].type, 'input_image');
  assert.equal(result.marketDate, '2026-08-19');
  assert.equal(result.rawSourceStored, false);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.observations.length, 10);
  assert.deepEqual(result.observations.find((row) => row.productKey === 'hsfo380'), {
    itemOrder: 3, productKey: 'hsfo380', productLabel: 'HSFO 380', quoteState: 'current_indication', contractMonth: '2026-09-01', unit: 'USD/MT', price: 578.5, reportedChange: 10.6, decimalPrecision: 2,
  });
  assert.equal(result.ignoredRows[0].label, '180 CST');
  assert.ok(result.previewToken.includes('.'));
});

test('morning vision preview canonicalizes product-deterministic ICE Gasoil units before strict review validation', async () => {
  const extracted = {
    marketDateText: '24-Aug',
    observations: [
      { sourceLabel: 'Oct BRT Fut', productKey: 'brent', quoteState: 'last_close', contractMonthText: 'Oct-26', priceText: '94.39', reportedChangeText: '0.61', unit: 'USD/BBL' },
      { sourceLabel: 'Oct GO Fut', productKey: 'ice_gasoil', quoteState: 'last_close', contractMonthText: 'Oct-26', priceText: '1271.75', reportedChangeText: '13.75', unit: 'USD/BBL' },
      { sourceLabel: '380cst Sep-26', productKey: 'hsfo380', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '573.50', reportedChangeText: '-1.59', unit: 'USD/MT' },
      { sourceLabel: '0.5% Sep-26', productKey: 'vlsfo', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '698.75', reportedChangeText: '+4.52', unit: 'USD/MT' },
      { sourceLabel: '10ppm Sep-26', productKey: 'lsmgo', quoteState: 'current_indication', contractMonthText: 'Sep-26', priceText: '160.03', reportedChangeText: '+1.35', unit: 'USD/BBL' },
      { sourceLabel: 'Oct GO Fut', productKey: 'ice_gasoil', quoteState: 'current_indication', contractMonthText: 'Oct-26', priceText: '1253.75', reportedChangeText: '-18', unit: 'USD/BBL' },
    ],
    ignoredRows: [],
    warnings: [],
  };
  const result = await previewMarketIntradaySnapshot({ id: 'actor', email: 'markets@example.test' }, {
    sourceType: 'morning_indication',
    receivedAt: '2026-08-24T11:04:55+08:00',
    mimeType: 'image/jpeg',
    imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
  }, {
    apiKey: 'test-key', env: TEST_ENV,
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(extracted) }) }),
  });

  assert.equal(result.marketDate, '2026-08-24');
  assert.deepEqual(result.observations.filter((row) => row.productKey === 'ice_gasoil').map((row) => row.unit), ['USD/MT', 'USD/MT']);
  assert.equal(result.warnings.filter((warning) => warning.includes('ICE Gasoil unit was normalized')).length, 1);
  assert.equal(result.observations.find((row) => row.productKey === 'ice_gasoil' && row.quoteState === 'last_close')?.price, 1271.75);
  assert.equal(result.observations.find((row) => row.productKey === 'ice_gasoil' && row.quoteState === 'current_indication')?.reportedChange, -18);
});

test('same-date movement and structure remain exact-snapshot and exact-contract', () => {
  const morning = [{ product_key: 'hsfo380', quote_state: 'current_indication', contract_month: '2026-09-01', unit: 'USD/MT', price: 578.5 }];
  const moc = [
    { product_key: 'hsfo380', contract_month: '2026-09-01', unit: 'USD/MT', price: 575 },
    { product_key: 'vlsfo', contract_month: '2026-09-01', unit: 'USD/MT', price: 694.1 },
  ];
  const movement = marketIntradayInternals.exactMovements(morning, moc);
  assert.equal(movement[0].movement, -3.5);
  assert.equal(movement[1].available, false);

  const structure = marketIntradayInternals.structureForSnapshot({ market_date: '2026-08-21' }, [
    { product_key: 'vlsfo', contract_month: '2026-08-01', unit: 'USD/MT', price: 700 },
    { product_key: 'vlsfo', contract_month: '2026-09-01', unit: 'USD/MT', price: 690 },
    { product_key: 'vlsfo', contract_month: '2026-10-01', unit: 'USD/MT', price: 685 },
  ]);
  assert.equal(structure[0].bmM1, 10);
  assert.equal(structure[0].m1M2, 5);
});

test('intraday handlers, permissions, service-only schema and UI review are wired', () => {
  const handler = read('api/functions/[name].js');
  const policy = read('api/_handlerPolicyRegistry.js');
  const migration = read('supabase/migrations/20260821145209_market_intraday_snapshots.sql');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const strip = read('src/hedge/views/market-intelligence/MarketIntradayStrip.jsx');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');

  assert.match(handler, /marketIntradaySnapshotPreview: \['markets'\]/);
  assert.match(handler, /marketIntradaySnapshotSave: \['markets'\]/);
  assert.match(handler, /marketIntradayTimeline: \['markets'\]/);
  assert.match(policy, /marketIntradaySnapshotPreview: readPolicy\([^\n]+"hedge_book_manage"/);
  assert.match(policy, /marketIntradaySnapshotSave: mutationPolicy\([^\n]+"hedge_book_manage"/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.market_intraday_snapshots from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on table public\.market_intraday_snapshots to service_role/);
  assert.match(migration, /protect_market_intelligence_immutable/);
  assert.match(migration, /not \(metadata \?\| array\['sourceText','image','prompt','rawResponse','rows','observations'\]\)/);
  assert.match(workspace, /<MarketIntradayStrip canManage=\{canManageMarketData\}/);
  assert.match(strip, /Upload morning image/);
  assert.match(strip, /Paste MOC reference/);
  assert.match(strip, /Confirm provisional snapshot/);
  assert.match(strip, /Official MOPS unchanged/);
  assert.match(pulse, /Intraday paper · Provisional/);
});
