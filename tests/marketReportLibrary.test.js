import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyzeMarketReportLibrary, loadMarketReportCatalogue } from '../api/_marketReportAnalysis.js';
import { extractMarketReportLibrary, marketReportPageText } from '../api/_marketReportLibrary.js';

test('report library parser retains exact product names, codes, ranges, prices and N/A states', () => {
  const parsed = extractMarketReportLibrary([
    [
      'Marine Fuel ($/mt) Code Mid Change',
      'Naphtha PAAAI00 752.25–752.75 752.500 -1.000',
      'Singapore MFSPD00 831.000 -4.000 Algeciras MFAGD00 682.000 -5.000',
      '0.5% FOB Fujairah cargo FOFF000 NA NANA FOFF001 688.000 +4.000',
      'Commentary references <PUAER00> but does not print a table value after the code.',
    ].join('\n'),
  ], { documentType: 'european_marketscan' });

  assert.equal(parsed.observationCount, 5);
  assert.equal(parsed.numericCount, 4);
  assert.equal(parsed.publishedNaCount, 1);
  assert.deepEqual(parsed.observations.find((row) => row.sourceSymbol === 'PAAAI00'), {
    sourceDocumentType: 'european_marketscan',
    sourcePage: 1,
    sourceOrder: 1,
    sourceSymbol: 'PAAAI00',
    productName: 'Naphtha',
    sectionName: 'Marine Fuel',
    unit: 'USD/MT',
    quoteState: 'numeric',
    price: 752.5,
    bid: 752.25,
    ask: 752.75,
    dayChange: -1,
    rowHash: parsed.observations[0].rowHash,
  });
  assert.equal(parsed.observations.find((row) => row.sourceSymbol === 'MFAGD00').productName, 'Algeciras');
  assert.equal(parsed.observations.find((row) => row.sourceSymbol === 'FOFF000').quoteState, 'published_na');
  assert.equal(parsed.observations.some((row) => row.sourceSymbol === 'PUAER00'), false);
  assert.match(parsed.observations[0].rowHash, /^[a-f0-9]{64}$/);
});

test('positioned PDF text is rebuilt into stable printed rows', () => {
  const text = marketReportPageText([
    { str: '831.000', transform: [1, 0, 0, 1, 200, 700] },
    { str: 'Singapore', transform: [1, 0, 0, 1, 10, 700] },
    { str: 'MFSPD00', transform: [1, 0, 0, 1, 100, 700] },
    { str: 'Algeciras', transform: [1, 0, 0, 1, 10, 680] },
    { str: 'MFAGD00', transform: [1, 0, 0, 1, 100, 680] },
  ]);
  assert.equal(text, 'Singapore\tMFSPD00\t831.000\nAlgeciras\tMFAGD00');
});

test('positioned report columns do not leak neighbouring commentary into product names', () => {
  const pageText = marketReportPageText([
    { str: 'Mediterranean cargoes ($/mt)', transform: [1, 0, 0, 1, 283.4554, 420], width: 90 },
    { str: 'PLATTS EU NAPHTHA PVO MOC TRADES ON CLOSE', transform: [1, 0, 0, 1, 55.2756, 400], width: 211.6089 },
    { str: 'HSFO 180 CST ($/mt)', transform: [1, 0, 0, 1, 283.4554, 400], width: 68.0428 },
    { str: 'PUADV00', transform: [1, 0, 0, 1, 411.0236, 400], width: 23.9277 },
    { str: '454.88–454.92', transform: [1, 0, 0, 1, 435.0282, 400], width: 73.878 },
    { str: '454.900', transform: [1, 0, 0, 1, 516.6202, 400], width: 38.78 },
    { str: '-1.350', transform: [1, 0, 0, 1, 551.7602, 400], width: 20.839 },
  ]);
  const parsed = extractMarketReportLibrary([pageText], { documentType: 'european_marketscan' });
  assert.equal(parsed.observationCount, 1);
  assert.equal(parsed.observations[0].productName, 'HSFO 180 CST ($/mt)');
  assert.equal(parsed.observations[0].sourceSymbol, 'PUADV00');
  assert.equal(parsed.observations[0].price, 454.9);
});

function libraryClient() {
  const catalogue = [{
    source_document_type: 'european_marketscan', source_symbol: 'AMFSA00',
    product_name: '0.5% FOB Singapore cargo', observation_unit: 'USD/MT',
    first_report_date: '2025-01-02', latest_report_date: '2026-08-21',
    numeric_observation_count: 2, published_na_count: 0,
  }];
  const imports = [
    { source_document_type: 'european_marketscan', report_date: '2025-01-02', library_observation_count: 1 },
    { source_document_type: 'european_marketscan', report_date: '2026-08-21', library_observation_count: 1 },
  ];
  const observations = [
    { report_date: '2025-01-02', source_document_type: 'european_marketscan', source_symbol: 'AMFSA00', product_name: '0.5% FOB Singapore cargo', observation_unit: 'USD/MT', quote_state: 'numeric', price: 600, bid: null, ask: null, day_change: 2, source_page: 3, row_hash: 'a'.repeat(64) },
    { report_date: '2026-08-21', source_document_type: 'european_marketscan', source_symbol: 'AMFSA00', product_name: '0.5% FOB Singapore cargo', observation_unit: 'USD/MT', quote_state: 'numeric', price: 700, bid: null, ask: null, day_change: -1, source_page: 3, row_hash: 'b'.repeat(64) },
  ];
  return {
    from(table) {
      const query = {
        select() { return query; }, in() { return query; }, gte() { return query; }, lte() { return query; },
        order() { return query; },
        async range() { return { data: table === 'market_report_product_catalogue' ? catalogue : observations, error: null }; },
        async limit() { return { data: imports, error: null }; },
      };
      return query;
    },
  };
}

test('catalogue and selectable-model analysis use bounded structured facts with store false', async () => {
  const client = libraryClient();
  const catalogue = await loadMarketReportCatalogue(client, {});
  assert.equal(catalogue.coverage.structuredObservationCount, 2);
  assert.equal(catalogue.catalogue[0].sourceSymbol, 'AMFSA00');
  const requests = [];
  const usages = [];
  const result = await analyzeMarketReportLibrary(client, { id: 'user-id' }, {
    seriesKeys: [catalogue.catalogue[0].key],
    startDate: '2025-01-01',
    endDate: '2026-08-21',
    prompt: 'Explain the period change.',
    modelId: 'gpt-5.6-terra',
  }, {
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          id: 'resp_test', model: 'gpt-5.6-terra', service_tier: 'default',
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
          output_text: JSON.stringify({
            summary: 'The reported price increased over the selected period.',
            findings: [{ title: 'Period increase', explanation: 'The first and latest structured values differ by 100 USD/MT.', evidenceIds: ['S1', 'S1P1', 'invalid'] }],
            caveats: [],
          }),
        }),
      };
    },
    onUsage: async (usage) => usages.push(usage),
  });
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].model, 'gpt-5.6-terra');
  assert.equal(JSON.stringify(requests[0]).includes('test-key'), false);
  assert.deepEqual(result.analysis.findings[0].evidenceIds, ['S1', 'S1P1']);
  assert.equal(result.deterministicSeries[0].stats.periodChange, 100);
  assert.equal(usages.length, 1);
});

test('market report library migration is immutable, service-only and atomically extends both import paths', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260822040856_market_report_product_library.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.market_report_product_observations enable row level security/i);
  assert.match(sql, /revoke all on table public\.market_report_product_observations from public, anon, authenticated/i);
  assert.match(sql, /with \(security_invoker = true\)/i);
  assert.match(sql, /record_market_report_product_library/i);
  assert.match(sql, /save_market_report_import\([\s\S]*p_library_observations jsonb/i);
  assert.match(sql, /save_market_drive_report_import\([\s\S]*p_library_observations jsonb/i);
  assert.doesNotMatch(sql, /pdf_bytes|report_text|raw_response/i);
});
