import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildMarketIntelligenceSnapshot, marketReportLimits, parseMarketReportText } from '../api/_marketIntelligence.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Bunkerwire parsing keeps delivered, posted and cargo symbols deterministic', () => {
  const report = `
    Bunkerwire Aug 18, 2026
    Singapore MFSPD00 801.000 +2.000
    Kaohsiung CBGAP00 1201.000 CB1AR00 811.000 CB3AN00 701.000
    0.5% FOB Singapore cargo AMFSA00 731.250 -1.500
  `;
  const result = parseMarketReportText(report, { documentType: 'bunkerwire' });
  assert.equal(result.reportDate, '2026-08-18');
  assert.deepEqual(result.observations.find((row) => row.sourceSymbol === 'MFSPD00'), {
    sourceSymbol: 'MFSPD00', price: 801, dayChange: 2, sourcePage: 1,
  });
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'CB1AR00').price, 811);
  assert.equal(result.observations.find((row) => row.sourceSymbol === 'CB3AN00').price, 701);
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

test('Markets UI keeps delivered observations separate from the MOPS settlement surface', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const service = read('api/_hedgeDeskService.js');
  assert.match(workspace, /Delivered Bunkers/);
  assert.match(workspace, /Cargo & Forward/);
  assert.match(workspace, /Trading Signals/);
  assert.match(workspace, /VLSFO is labelled <strong>LS180<\/strong>/);
  assert.match(workspace, /MF-380<\/strong> is mapped to HSFO 380/);
  assert.match(service, /loadMarketIntelligence\(client\)/);
  assert.match(service, /if \(String\(body\?\.entity \|\| ''\) !== 'MopsPrice'\)/);
});
