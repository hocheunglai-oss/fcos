import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildMarketHistoryResponse,
  buildMarketIntelligenceSnapshot,
  calculateMarketHorizonStats,
  marketReportLimits,
  parseMarketReportText,
} from '../api/_marketIntelligence.js';
import { buildMarketReplayImpact, exactMopsTriple } from '../scripts/replay-market-report-archive.mjs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const basicObservation = ({ sourceSymbol, price, dayChange, sourcePage }) => ({ sourceSymbol, price, dayChange, sourcePage });

test('Bunkerwire parsing keeps delivered, posted and cargo symbols deterministic', () => {
  const report = `
    Bunkerwire Aug 18, 2026
    Singapore MFSPD00 801.000 +2.000
    Kaohsiung CBGAP00 1201.000 CB1AR00 811.000 CB3AN00 701.000
    0.5% FOB Singapore cargo AMFSA00 731.250 -1.500
  `;
  const result = parseMarketReportText(report, { documentType: 'bunkerwire' });
  assert.equal(result.reportDate, '2026-08-18');
  assert.deepEqual(basicObservation(result.observations.find((row) => row.sourceSymbol === 'MFSPD00')), {
    sourceSymbol: 'MFSPD00', price: 801, dayChange: 2, sourcePage: 1,
  });
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'CB1AR00').price, 811);
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'CB3AN00').price, 701);
});

test('Bunkerwire parsing adds all three exact Hong Kong delivered symbols', () => {
  const result = parseMarketReportText(`
    Bunkerwire Aug 19, 2026
    Hong Kong MFHKD00 871.000 +47.000
    Hong Kong PUAER00 684.00-685.00 684.500 +13.500 AAXYQ00 1242.00 +32.000
  `, { documentType: 'bunkerwire' });
  assert.deepEqual(result.observations.filter((row) => ['MFHKD00', 'PUAER00', 'AAXYQ00'].includes(row.sourceSymbol)).map(basicObservation), [
    { sourceSymbol: 'MFHKD00', price: 871, dayChange: 47, sourcePage: 1 },
    { sourceSymbol: 'PUAER00', price: 684.5, dayChange: 13.5, sourcePage: 3 },
    { sourceSymbol: 'AAXYQ00', price: 1242, dayChange: 32, sourcePage: 3 },
  ]);
});

test('European Marketscan parser supports BM, M1/M2 and East-West symbols', () => {
  const report = `
    European Marketscan Aug 18, 2026
    FOFS000 720.000 +1.000 FOFS001 710.000 +2.000 FOFS002 700.000 +3.000
    FPLSM01 560.000 +4.000 FPLSM02 550.000 +5.000
    FQLSM01 45.000 -1.000 FQLSM02 40.000 -2.000
    MSGSL00 150.000 +1.500 MSHSL00 148.000 +1.250
  `;
  const result = parseMarketReportText(report, { documentType: 'european_marketscan' });
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'FOFS000').sourcePage, 3);
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'FQLSM01').dayChange, -1);
});

test('European Marketscan parsing requires no proxy for the complete MOPS trio', () => {
  const result = parseMarketReportText(`
    European Marketscan Aug 19, 2026
    0.5% FOB Singapore cargo AMFSA00 746.970 -5.320
    HSFO 380 CST ($/mt) PPXDK00 611.88-611.92 611.900 +3.920
    Gasoil POABC00 165.90-165.94 165.920 +0.700
  `, { documentType: 'european_marketscan' });
  assert.deepEqual(result.observations.filter((row) => ['AMFSA00', 'PPXDK00', 'POABC00'].includes(row.sourceSymbol)).map(basicObservation), [
    { sourceSymbol: 'AMFSA00', price: 746.97, dayChange: -5.32, sourcePage: 3 },
    { sourceSymbol: 'PPXDK00', price: 611.9, dayChange: 3.92, sourcePage: 9 },
    { sourceSymbol: 'POABC00', price: 165.92, dayChange: 0.7, sourcePage: 9 },
  ]);
});

test('European Marketscan parser preserves zero and negative East-West spreads', () => {
  const zero = parseMarketReportText(`
    European Marketscan Aug 12, 2025
    FQLSM01 0.000 NANA FQLSM02 5.500 +0.250
  `, { documentType: 'european_marketscan' });
  assert.equal(zero.observations.find((row) => row.sourceSymbol === 'FQLSM01').price, 0);

  const negative = parseMarketReportText(`
    European Marketscan Aug 13, 2025
    FQLSM01 -2.250 -1.000 FQLSM02 -0.500 +0.250
  `, { documentType: 'european_marketscan' });
  assert.equal(negative.observations.find((row) => row.sourceSymbol === 'FQLSM01').price, -2.25);
  assert.equal(negative.observations.find((row) => row.sourceSymbol === 'FQLSM02').price, -0.5);
});

test('report header date overrides a misleading archive filename', () => {
  const result = parseMarketReportText(`
    Bunkerwire September 5, 2025
    Singapore MFSPD00 701.000 +2.000
  `, { documentType: 'bunkerwire', filename: 'BW_20250509.pdf' });
  assert.equal(result.reportDate, '2025-09-05');
});

test('market report upload limit accepts bounded historical reports up to 5 MB', () => {
  assert.equal(marketReportLimits.maxBytes, 5_000_000);
});

test('market snapshot calculates port relative value and cargo premium without affecting MOPS', () => {
  const series = [
    { id: 'sg-delivered', market_family: 'delivered', port_key: 'singapore', port_label: 'Singapore', product_key: 'vlsfo', product_label: 'VLSFO 0.5%', source_symbol: 'MFSPD00', source_name: 'Source', source_type: 'assessment', currency_code: 'USD', unit: 'USD/MT', display_order: 1 },
    { id: 'kh-delivered', market_family: 'delivered', port_key: 'kaohsiung', port_label: 'Kaohsiung', product_key: 'vlsfo', product_label: 'VLSFO 0.5%', alias_label: 'LS180', source_symbol: 'CB1AR00', source_name: 'Source', source_type: 'posted', currency_code: 'USD', unit: 'USD/MT', display_order: 2 },
    { id: 'cargo', market_family: 'cargo', port_key: 'singapore', port_label: 'Singapore', product_key: 'vlsfo', product_label: 'VLSFO cargo', source_symbol: 'AMFSA00', source_name: 'Source', source_type: 'assessment', currency_code: 'USD', unit: 'USD/MT', display_order: 3 },
  ];
  const observations = [
    { id: 'one', series_id: 'sg-delivered', price_date: '2026-08-18', price: 835, day_change: 3, quality_status: 'verified' },
    { id: 'two', series_id: 'kh-delivered', price_date: '2026-08-18', price: 823, day_change: null, quality_status: 'verified' },
    { id: 'three', series_id: 'cargo', price_date: '2026-08-18', price: 752.29, day_change: 4.35, quality_status: 'verified' },
  ];
  const result = buildMarketIntelligenceSnapshot(series, observations, { today: new Date('2026-08-20T00:00:00Z') });
  assert.equal(result.delivered.find((row) => row.portKey === 'singapore').deliveredPremium, 82.71);
  assert.equal(result.delivered.find((row) => row.portKey === 'kaohsiung').aliasLabel, 'LS180');
  assert.equal(result.signals.relativeValue.find((row) => row.productKey === 'vlsfo').spread, 12);
});

test('market snapshot keeps unpublished delivered rows unavailable without dereferencing a missing spread', () => {
  const series = [
    { id: 'west-korea-delivered', market_family: 'delivered', port_key: 'south-korea-west', port_label: 'South Korea (West)', product_key: 'hsfo380', product_label: 'HSFO 380', source_symbol: 'UNAVAILABLE', source_name: 'Not published', source_type: 'unavailable', currency_code: 'USD', unit: 'USD/MT', display_order: 1 },
    { id: 'mops-hsfo', market_family: 'cargo', port_key: 'singapore', port_label: 'Singapore', product_key: 'hsfo380', product_label: 'S380 MOPS', source_symbol: 'PPXDK00', source_name: 'European Marketscan', source_type: 'assessment', currency_code: 'USD', unit: 'USD/MT', display_order: 2 },
  ];
  const result = buildMarketIntelligenceSnapshot(series, [], { today: new Date('2026-08-20T00:00:00Z') });
  const unavailable = result.delivered[0];
  assert.equal(unavailable.latest, null);
  assert.equal(unavailable.latestSpread, null);
  assert.equal(unavailable.deliveredPremium, null);
});

test('market horizon statistics use exact matched dates and report movement rather than interpolation', () => {
  const stats = calculateMarketHorizonStats([
    { date: '2026-08-13', spread: 10 },
    { date: '2026-08-15', spread: 14 },
    { date: '2026-08-19', spread: 8 },
  ], '2026-08-19');
  assert.deepEqual(stats['1w'], {
    startDate: '2026-08-13', endDate: '2026-08-19', matchedSamples: 3,
    average: 10.667, low: 8, high: 14, movement: -2,
  });
});

test('history response converts SGO with 7.45 and suppresses a report-ledger mismatch', () => {
  const series = [
    { id: 'hk-go', market_family: 'delivered', port_key: 'hong-kong', port_label: 'Hong Kong', product_key: 'lsmgo', product_label: 'LSMGO 0.1%', source_symbol: 'AAXYQ00', source_type: 'assessment', display_order: 1 },
    { id: 'mops-go', market_family: 'cargo', port_key: 'singapore', port_label: 'Singapore', product_key: 'lsmgo', product_label: 'SGO MOPS', source_symbol: 'POABC00', source_type: 'assessment', unit: 'USD/BBL', usd_mt_factor: 7.45, benchmark_label: 'SGO MOPS × 7.45', display_order: 2 },
  ];
  const observations = [
    { id: 'one', series_id: 'hk-go', price_date: '2026-08-19', price: 1242, day_change: 32, quality_status: 'verified' },
    { id: 'two', series_id: 'mops-go', price_date: '2026-08-19', price: 165.92, day_change: 0.7, quality_status: 'verified' },
  ];
  const ok = buildMarketHistoryResponse(series, observations, [{ price_date: '2026-08-19', sgo: 165.92, is_estimate: false }], [], { range: '1w', products: ['lsmgo'], ports: ['hong-kong'], endDate: '2026-08-19' });
  assert.equal(ok.panels[0].benchmark.points[0].usdMt, 1236.104);
  assert.equal(ok.panels[0].series[0].points[0].spread, 5.896);

  const mismatch = buildMarketHistoryResponse(series, observations, [{ price_date: '2026-08-19', sgo: 166, is_estimate: false }], [], { range: '1w', products: ['lsmgo'], ports: ['hong-kong'], endDate: '2026-08-19' });
  assert.equal(mismatch.panels[0].series[0].points[0].spread, null);
  assert.equal(mismatch.warnings[0].code, 'MOPS_LEDGER_VALUE_MISMATCH');
});

test('market history defaults to HSFO, S0.5%, then LSMGO product order', () => {
  const series = [
    { id: 'sg-vlsfo', market_family: 'delivered', port_key: 'singapore', port_label: 'Singapore', product_key: 'vlsfo', product_label: 'VLSFO 0.5%', source_symbol: 'MFSPD00', source_type: 'assessment', display_order: 1 },
    { id: 'sg-hsfo', market_family: 'delivered', port_key: 'singapore', port_label: 'Singapore', product_key: 'hsfo380', product_label: 'HSFO 380', source_symbol: 'PUAFT00', source_type: 'assessment', display_order: 2 },
    { id: 'sg-lsmgo', market_family: 'delivered', port_key: 'singapore', port_label: 'Singapore', product_key: 'lsmgo', product_label: 'LSMGO 0.1%', source_symbol: 'AAXYO00', source_type: 'assessment', display_order: 3 },
  ];
  const result = buildMarketHistoryResponse(series, [], [], [], { range: '1w', ports: ['singapore'], endDate: '2026-08-19' });
  assert.deepEqual(result.products, ['hsfo380', 'vlsfo', 'lsmgo']);
  assert.deepEqual(result.panels.map((panel) => panel.productKey), ['hsfo380', 'vlsfo', 'lsmgo']);
});

test('archive replay impact is deterministic and distinguishes matches, creates and actual conflicts', () => {
  const complete = {
    documentType: 'european_marketscan', reportDate: '2025-01-02', sourceHash: 'a'.repeat(64),
    observations: [
      { sourceSymbol: 'AMFSA00', price: 500 },
      { sourceSymbol: 'PPXDK00', price: 400 },
      { sourceSymbol: 'POABC00', price: 100 },
    ],
  };
  assert.deepEqual(exactMopsTriple(complete), { s05: 500, s380: 400, sgo: 100 });
  const archive = {
    discoveredFiles: 3, duplicateFiles: 1, parseFailures: [],
    reports: [
      complete,
      { ...complete, reportDate: '2025-01-03', sourceHash: 'b'.repeat(64) },
      { ...complete, reportDate: '2025-01-04', sourceHash: 'c'.repeat(64) },
    ],
  };
  const impact = buildMarketReplayImpact(archive, new Map([
    ['2025-01-02', { s05: 500, s380: 400, sgo: 100, is_estimate: false }],
    ['2025-01-04', { s05: 501, s380: 400, sgo: 100, is_estimate: false }],
  ]));
  assert.match(impact.impactHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(impact.settlementOutcomes, {
    create: 1, replace_estimate: 0, match_actual: 1, conflict_actual: 1,
  });
  assert.deepEqual(impact.conflicts, ['2025-01-04']);
});

test('archive replay fails closed on a Supabase project mismatch before live access', () => {
  const replay = read('scripts/replay-market-report-archive.mjs');
  assert.match(replay, /EXPECTED_SUPABASE_PROJECT_REF = fcosConnectionIdentifier\('supabase', 'Project ref'\)/);
  assert.match(replay, /projectRef !== EXPECTED_SUPABASE_PROJECT_REF/);
  assert.match(replay, /Supabase identity mismatch/);
});

test('service-only migration pins Kaohsiung product terminology and hardens browser access', () => {
  const migration = read('supabase/migrations/20260820072654_market_intelligence_delivered_prices.sql');
  assert.match(migration, /'kaohsiung'.*'vlsfo'.*'VLSFO 0\.5%'.*'LS180'.*'CB1AR00'.*'posted'/);
  assert.match(migration, /'kaohsiung'.*'hsfo380'.*'HSFO 380'.*'MF-380'.*'CB3AN00'.*'posted'/);
  assert.match(migration, /alter table public\.market_price_observations enable row level security/i);
  assert.match(migration, /revoke all on table public\.market_price_observations from public, anon, authenticated/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('spread-value migration permits signed spreads without weakening absolute-price validation', () => {
  const migration = read('supabase/migrations/20260820092817_market_intelligence_spread_values.sql');
  assert.match(migration, /value_kind text not null default 'absolute'/i);
  assert.match(migration, /source_symbol in \('FQLSM01', 'FQLSM02'\)/i);
  assert.match(migration, /v_series\.value_kind <> 'spread'.*v_price <= 0/is);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function public\.validate_market_observation_value\(\) from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('report replay migration reconciles parser improvements without duplicate audit events', () => {
  const migration = read('supabase/migrations/20260820093157_market_report_replay_reconciliation.sql');
  assert.match(migration, /for update/i);
  assert.match(migration, /MARKET_REPORT_REPLAY_CONFLICT/);
  assert.match(migration, /set observation_count = jsonb_array_length\(p_observations\)/i);
  assert.match(migration, /on conflict \(series_id, price_date\) do update/i);
  assert.match(migration, /if v_replayed then\s+update public\.market_intelligence_events/is);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('premium and MOPS migration preserves evidence, canonical dates and service-only publication', () => {
  const migration = read('supabase/migrations/20260820105504_delivered_price_premium_mops_analytics.sql');
  assert.match(migration, /'hong-kong'.*'MFHKD00'/s);
  assert.match(migration, /'hong-kong'.*'PUAER00'/s);
  assert.match(migration, /'hong-kong'.*'AAXYQ00'/s);
  assert.match(migration, /market_observation_evidence_immutable/i);
  assert.match(migration, /SAME_DATE_SOURCE_VALUE_MISMATCH/);
  assert.match(migration, /publish_market_mops_from_import/);
  assert.match(migration, /AMFSA00.*PPXDK00.*POABC00/s);
  assert.match(migration, /hedge_market_prices_canonical_date_unique/);
  assert.match(migration, /revoke all on table public\.market_mops_publications from public, anon, authenticated/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer|pdf_bytes|report_text/i);
});

test('Markets UI keeps delivered observations separate from the MOPS settlement surface', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const service = read('api/_hedgeDeskService.js');
  assert.match(workspace, /Major-port delivered prices/);
  assert.doesNotMatch(workspace, /<CargoForwardSummary intelligence=/);
  assert.doesNotMatch(workspace, /<TradingSignals intelligence=/);
  assert.match(workspace, /VLSFO is <strong>LS180<\/strong>/);
  assert.match(workspace, /HSFO 380 is <strong>MF-380<\/strong>/);
  assert.match(workspace, /syncId="delivered-mops"/);
  assert.match(workspace, /Premium vs MOPS/);
  assert.match(workspace, /Not published/);
  assert.ok(workspace.indexOf("value: 'hsfo380'") < workspace.indexOf("value: 'vlsfo'"));
  assert.ok(workspace.indexOf("value: 'vlsfo'") < workspace.indexOf("value: 'lsmgo'"));
  assert.match(workspace, /initialProducts\[0\] \|\| PRODUCTS\[0\]\.value/);
  assert.match(workspace, /PRODUCT_ORDER\.get\(left\.productKey\)/);
  assert.match(workspace, /ports\.some\(\(\[key\]\) => key === 'singapore'\) \? \['singapore'\]/);
  assert.match(workspace, /initialFilters\.includeMops !== false/);
  assert.match(workspace, /fcos:markets:delivered:v1/);
  assert.match(service, /loadMarketIntelligence\(client\)/);
  assert.match(service, /loadMarketIntelligenceHistory\(client, body\)/);
  assert.match(service, /if \(String\(body\?\.entity \|\| ''\) !== 'MopsPrice'\)/);
});
