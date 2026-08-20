import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  marketPublicationEligible,
  nextMarketPublicationDate,
  parseMarketReportText,
} from '../api/_marketIntelligence.js';
import { marketIntelligenceTradingInternals } from '../api/_marketIntelligenceTrading.js';
import { publishMarketDataQualityAlert, saveMarketIntelligenceAlertRules, scanExpectedMarketSessions } from '../api/_marketIntelligenceTrading.js';
import { projectedMopsSettlement } from '../shared/plattsMarketModel.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('printed FOFS contract months survive the May roll while the non-publication reprint is evidence-only', () => {
  const may1 = parseMarketReportText(`
    European Marketscan May 1, 2025
    Marine Fuel 0.5% Derivatives April May June
    April FOFS000 470.000 -5.000 May FOFS001 462.500 -12.250 June FOFS002 456.090 -12.360
    AMFSA00 466.450 -12.730
  `, { documentType: 'european_marketscan' });
  assert.equal(may1.observations.find((row) => row.sourceSymbol === 'FOFS001').contractMonth, '2025-05-01');
  assert.equal(may1.observations.find((row) => row.sourceSymbol === 'FOFS002').contractMonth, '2025-06-01');
  assert.equal(may1.observations.find((row) => row.sourceSymbol === 'AMFSA00').basisMetadata.publicationEligible, false);
  assert.equal(may1.observations.find((row) => row.sourceSymbol === 'FOFS001').basisMetadata.publicationEligible, false);

  const may2 = parseMarketReportText(`
    European Marketscan May 2, 2025
    Marine Fuel 0.5% Derivatives May June July
    May FOFS000 467.200 +1.000 June FOFS001 459.000 +1.000 July FOFS002 453.750 +1.000
  `, { documentType: 'european_marketscan' });
  assert.deepEqual(may2.observations.filter((row) => /^FOFS/.test(row.sourceSymbol)).map((row) => row.contractMonth), ['2025-05-01', '2025-06-01', '2025-07-01']);
  assert.ok(may2.observations.filter((row) => /^FOFS/.test(row.sourceSymbol)).every((row) => row.basisMetadata.publicationEligible));
});

test('literal EFS balance month and printed ICE prompt month are authoritative intramonth', () => {
  const aug3 = parseMarketReportText(`
    European Marketscan August 3, 2026
    Balance month MSJSL00 -2.500 -0.250
    August AARIN00 700.000 +1.000 August ICLO001 701.000 +1.000
  `, { documentType: 'european_marketscan' });
  assert.equal(aug3.observations.find((row) => row.sourceSymbol === 'MSJSL00').contractMonth, '2026-08-01');
  assert.equal(aug3.observations.find((row) => row.sourceSymbol === 'AARIN00').contractMonth, '2026-08-01');
  assert.equal(aug3.observations.find((row) => row.sourceSymbol === 'ICLO001').contractMonth, '2026-08-01');

  const aug19 = parseMarketReportText(`
    European Marketscan August 19, 2026
    September AARIN00 710.000 +1.000 September ICLO001 711.000 +1.000
  `, { documentType: 'european_marketscan' });
  assert.equal(aug19.observations.find((row) => row.sourceSymbol === 'AARIN00').contractMonth, '2026-09-01');
  assert.equal(aug19.observations.find((row) => row.sourceSymbol === 'ICLO001').contractMonth, '2026-09-01');
});

test('Asia and London session gaps remain independent on the Aug 10 Singapore holiday', () => {
  const report = parseMarketReportText(`
    European Marketscan August 10, 2026
    European financial derivatives: August 10, 2026 ($/mt) Code August* Change Code September Change Code October Change London MOC
    AMFSA00 NA NA Marine Fuel 0.5% Derivatives August September October
    August FOFS000 NA NA September FOFS001 NA NA October FOFS002 NA NA
    September FPLSM01 573.000 +1.000 October FPLSM02 534.250 +1.000
    September MSGSL00 160.270 +1.000 October MSHSL00 153.910 +1.000
  `, { documentType: 'european_marketscan' });
  assert.equal(report.observations.some((row) => row.sourceSymbol === 'AMFSA00'), false);
  assert.equal(report.observations.some((row) => /^FOFS/.test(row.sourceSymbol)), false);
  assert.equal(report.observations.find((row) => row.sourceSymbol === 'FPLSM01').basisMetadata.publicationEligible, true);
  assert.equal(report.observations.find((row) => row.sourceSymbol === 'MSGSL00').assessmentSession, 'london_moc');
  assert.equal(report.observations.find((row) => row.sourceSymbol === 'FPLSM01').printedContractMonth, '2026-09-01');
  assert.equal(report.observations.find((row) => row.sourceSymbol === 'MSGSL00').printedContractMonth, '2026-09-01');
});

test('London financial rows use the exact printed table months', () => {
  const report = parseMarketReportText(`
    European Marketscan August 19, 2026
    European financial derivatives: August 19, 2026 ($/mt) Code August* Change Code September Change Code October Change London MOC
    FPLSM01 573.000 -2.000 FPLSM02 534.250 -0.750
    BSGSL00 165.920 0.000 MSGSL00 160.270 +0.420 MSHSL00 153.910 +0.570
  `, { documentType: 'european_marketscan' });
  assert.deepEqual(report.observations.filter((row) => ['FPLSM01', 'FPLSM02'].includes(row.sourceSymbol)).map((row) => row.contractMonth), ['2026-09-01', '2026-10-01']);
  assert.deepEqual(report.observations.filter((row) => ['BSGSL00', 'MSGSL00', 'MSHSL00'].includes(row.sourceSymbol)).map((row) => row.contractMonth), ['2026-08-01', '2026-09-01', '2026-10-01']);
  assert.ok(report.observations.every((row) => row.basisMetadata.contractMonthSource === 'printed'));
});

test('unsigned zero daily changes remain numeric evidence', () => {
  const report = parseMarketReportText(`
    European Marketscan May 2, 2025
    FQLSM02 18.000 0.000
  `, { documentType: 'european_marketscan' });
  assert.equal(report.observations.find((row) => row.sourceSymbol === 'FQLSM02').dayChange, 0);
});

test('LSMGO delivered-premium moves convert SGO USD per barrel before comparison', () => {
  const metrics = marketIntelligenceTradingInternals.physicalMetrics([
    { reportDate: '2026-08-19', productKey: 'lsmgo', marketFamily: 'delivered', assessmentSession: 'asia_moc', sourceSymbol: 'AAXYO00', value: 1265, dayChange: 10, reportId: 'r', seriesId: 'd' },
    { reportDate: '2026-08-19', productKey: 'lsmgo', marketFamily: 'cargo', assessmentSession: 'asia_moc', sourceSymbol: 'POABC00', value: 165.92, dayChange: 0.7, reportId: 'r', seriesId: 'm' },
  ], '2026-08-19', ['lsmgo']);
  assert.equal(metrics.premiumMoves[0].change, 4.785);
});

test('approved Singapore calendar excludes Aug 10 and fails closed outside reviewed years', () => {
  assert.equal(marketPublicationEligible('2026-08-10', 'asia_moc'), false);
  assert.equal(nextMarketPublicationDate('2026-08-07', 'asia_moc'), '2026-08-11');
  assert.equal(nextMarketPublicationDate('2026-08-28', 'london_moc'), '2026-09-01');
  assert.equal(marketPublicationEligible('2026-08-31', 'london_moc'), false);
  assert.equal(marketPublicationEligible('2027-08-10', 'asia_moc'), null);
  assert.equal(marketPublicationEligible('2027-08-10', 'london_moc'), null);
  assert.equal(nextMarketPublicationDate('2027-08-09', 'asia_moc'), null);
  assert.equal(marketIntelligenceTradingInternals.latestReviewedPublicationDate('2026-08-22', 'asia_moc'), '2026-08-21');
  assert.equal(marketIntelligenceTradingInternals.latestReviewedPublicationDate('2026-08-10', 'asia_moc'), '2026-08-07');
  assert.equal(marketIntelligenceTradingInternals.latestReviewedPublicationDate('2026-08-31', 'london_moc'), '2026-08-28');
  assert.equal(marketIntelligenceTradingInternals.isoDate(new Date('2026-08-20T16:30:00Z')), '2026-08-21');
});

test('London holiday and unknown-year report rows remain evidence-only', () => {
  const holiday = parseMarketReportText(`
    European Marketscan August 31, 2026
    European financial derivatives: August 31, 2026 ($/mt) Code August Change Code September Change Code October Change London MOC
    September FPLSM01 573.000 +1.000 October FPLSM02 534.250 +1.000
  `, { documentType: 'european_marketscan' });
  assert.equal(holiday.observations.find((row) => row.sourceSymbol === 'FPLSM01').basisMetadata.publicationEligible, false);
  assert.equal(holiday.observations.find((row) => row.sourceSymbol === 'FPLSM01').basisMetadata.calendarKnown, true);

  const unknownYear = parseMarketReportText(`
    European Marketscan August 10, 2027
    European financial derivatives: August 10, 2027 ($/mt) Code August Change Code September Change Code October Change London MOC
    September FPLSM01 573.000 +1.000 October FPLSM02 534.250 +1.000
  `, { documentType: 'european_marketscan' });
  assert.equal(unknownYear.observations.find((row) => row.sourceSymbol === 'FPLSM01').basisMetadata.publicationEligible, false);
  assert.equal(unknownYear.observations.find((row) => row.sourceSymbol === 'FPLSM01').basisMetadata.calendarKnown, false);
});

test('ICE LSGO forward prompt months never wrap into the past at the six-month boundary', () => {
  const report = parseMarketReportText(`
    European Marketscan August 19, 2026
    September ICLO001 700.000 +1.000 October ICLO002 701.000 +1.000 November ICLO003 702.000 +1.000
    December ICLO004 703.000 +1.000 January ICLO005 704.000 +1.000 February ICLO006 705.000 +1.000
  `, { documentType: 'european_marketscan' });
  const months = report.observations.filter((row) => /^ICLO00[1-6]$/.test(row.sourceSymbol)).map((row) => row.contractMonth);
  assert.deepEqual(months, ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
  assert.ok(months.every((month, index) => month.slice(0, 7) >= '2026-08' && (!index || month >= months[index - 1])));
});

test('runtime settlement projection uses the approved publication-day BM formula and remains shadow-gated', () => {
  const publicationDays = marketIntelligenceTradingInternals.reviewedPublicationDays('2026-08', 'asia_moc');
  const prior = publicationDays.filter((date) => date < '2026-08-19');
  const rows = marketIntelligenceTradingInternals.projectedSettlementRows({
    asOfDate: '2026-08-19',
    products: ['vlsfo'],
    snapshot: [{ id: 'bm', productKey: 'vlsfo', tenor: 'BM', contractMonth: '2026-08-01', reportDate: '2026-08-19', value: 733.25, unit: 'USD/MT', qualityStatus: 'verified' }],
    fallbacks: [],
    actuals: prior.map((date) => ({ price_date: date, s05: 700, is_estimate: false })),
    verifications: [],
    shadow: { cutoverApproved: false },
  });
  const current = rows.find((row) => row.period === 'current');
  assert.equal(current.available, true);
  assert.ok(Math.abs(current.value - 714.9625) <= 0.001);
  assert.equal(current.authorizedForValuation, false);
  assert.equal(current.points.length, 20);
  assert.equal(current.points.find((point) => point.priceDate === '2026-08-18').value, 700);
  assert.equal(current.points.find((point) => point.priceDate === '2026-08-19').value, 733.25);
});

test('HSFO and LSMGO settlement points use the reviewed London calendar', () => {
  const londonDays = marketIntelligenceTradingInternals.reviewedPublicationDays('2026-08', 'london_moc');
  assert.equal(londonDays.includes('2026-08-31'), false);
  const prior = londonDays.filter((date) => date < '2026-08-28');
  const rows = marketIntelligenceTradingInternals.projectedSettlementRows({
    asOfDate: '2026-08-28',
    products: ['lsmgo'],
    snapshot: [{ id: 'bm', productKey: 'lsmgo', tenor: 'BM', contractMonth: '2026-08-01', reportDate: '2026-08-28', value: 160, unit: 'USD/BBL', qualityStatus: 'verified' }],
    fallbacks: [],
    actuals: prior.map((date) => ({ price_date: date, sgo: 150, is_estimate: false })),
    verifications: [],
    shadow: { cutoverApproved: false },
  });
  const current = rows.find((row) => row.period === 'current');
  assert.equal(current.available, true);
  assert.equal(current.points.some((point) => point.priceDate === '2026-08-31'), false);
});

test('weekend current-month projection uses Friday BM as its assessment cutoff', () => {
  const publicationDays = marketIntelligenceTradingInternals.reviewedPublicationDays('2026-08', 'asia_moc');
  const prior = publicationDays.filter((date) => date < '2026-08-21');
  const rows = marketIntelligenceTradingInternals.projectedSettlementRows({
    asOfDate: '2026-08-22',
    products: ['vlsfo'],
    snapshot: [{ id: 'bm', productKey: 'vlsfo', tenor: 'BM', contractMonth: '2026-08-01', reportDate: '2026-08-21', value: 740, unit: 'USD/MT', qualityStatus: 'verified' }],
    fallbacks: [],
    actuals: prior.map((date) => ({ price_date: date, s05: 700, is_estimate: false })),
    verifications: [],
    shadow: { cutoverApproved: false },
  });
  const current = rows.find((row) => row.period === 'current');
  assert.equal(current.available, true);
  assert.equal(current.assessmentDate, '2026-08-21');
  assert.equal(current.points.find((point) => point.priceDate === '2026-08-21').value, 740);
});

test('active weekend BM fallback uses Friday publication cutoff until expiry', () => {
  const publicationDays = marketIntelligenceTradingInternals.reviewedPublicationDays('2026-08', 'london_moc');
  const prior = publicationDays.filter((date) => date < '2026-08-21');
  const rows = marketIntelligenceTradingInternals.projectedSettlementRows({
    asOfDate: '2026-08-22',
    products: ['hsfo380'],
    snapshot: [{ id: 'fallback', productKey: 'hsfo380', tenor: 'BM', contractMonth: '2026-08-01', reportDate: '2026-08-22', expiresOn: '2026-08-24', value: 600, unit: 'USD/MT', qualityStatus: 'authorized_fallback' }],
    fallbacks: [],
    actuals: prior.map((date) => ({ price_date: date, s380: 575, is_estimate: false })),
    verifications: [],
    shadow: { cutoverApproved: false },
  });
  const current = rows.find((row) => row.period === 'current');
  assert.equal(current.available, true);
  assert.equal(current.assessmentDate, '2026-08-21');
  assert.equal(current.points.find((point) => point.priceDate === '2026-08-21').value, 600);
  assert.equal(current.points.find((point) => point.priceDate === '2026-08-21').source, 'authorized_manual_fallback');
});

test('August 2026 BM projection uses all 20 approved publication days and excludes Aug 10', () => {
  const publicationDays = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    if (marketPublicationEligible(date, 'asia_moc')) publicationDays.push(date);
  }
  assert.equal(publicationDays.length, 20);
  const prior = publicationDays.filter((date) => date < '2026-08-19');
  assert.equal(prior.length, 11);
  const result = projectedMopsSettlement({
    contractMonth: '2026-08',
    asOfDate: '2026-08-19',
    publicationDays,
    actuals: prior.map((date) => ({ date, value: 700 })),
    balanceMonthValue: 733.25,
  });
  assert.equal(result.available, true);
  assert.ok(Math.abs(result.value - 714.9625) <= 0.001);
});

test('AI brief validation rebuilds lineage and rejects verbatim or unverified facts', () => {
  const sourceHash = 'a'.repeat(64);
  const pages = [{ sourceHash, page: 3, text: 'Availability tightened and the verified marker was AMFSA00 731.25 for the prompt market. Example Trading Ltd participated.' }];
  const observations = [{ sourceHash, page: 3, symbol: 'AMFSA00', value: 731.25 }];
  const valid = marketIntelligenceTradingInternals.validateAiItems([{
    kind: 'driver', title: 'Prompt availability tightens', summary: 'Prompt supply conditions tightened.',
    driverTags: ['availability'], direction: 'supportive', confidence: 0.8, productKey: 'vlsfo',
    portKey: 'singapore', horizon: 'prompt', sourceRefs: [{ sourceHash, page: 3, rawText: 'forbidden' }],
    numericFacts: [{ sourceHash, page: 3, value: '731.25', symbol: 'AMFSA00', rawText: 'forbidden' }],
  }], pages, observations);
  assert.deepEqual(valid[0].sourceRefs, [{ sourceHash, page: 3 }]);
  assert.deepEqual(valid[0].numericFacts, [{ sourceHash, page: 3, value: '731.25', symbol: 'AMFSA00' }]);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary: pages[0].text }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary: 'The value was 999.' }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary: 'The value was 57.', numericFacts: [{ sourceHash, page: 3, value: '57', symbol: 'AMFSA00' }] }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], numericFacts: [{ sourceHash, page: 3, value: '731.25', symbol: 'PPXDK00' }] }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], numericFacts: [{ sourceHash, page: 4, value: '731.25', symbol: 'AMFSA00' }] }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], title: 'Availability tightened and the verified marker was AMFSA00 731.25', summary: 'Prompt supply conditions tightened.' }], pages, observations).length, 0);
  for (const summary of ['The price was $999.', 'The price was 1,200/mt.', 'The move was 5%.', 'The value was (999).']) {
    assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary, numericFacts: [] }], pages, observations).length, 0);
  }
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary: 'Example Trading Ltd tightened supply.' }], pages, observations).length, 0);
  assert.equal(marketIntelligenceTradingInternals.validateAiItems([{ ...valid[0], summary: 'TRAFIGURA PTE LTD tightened supply.' }], pages, observations, ['TRAFIGURA PTE LTD']).length, 0);
});

test('cutover scope follows the latest exact contract roll and includes gasoil BM', () => {
  const latestDate = '2026-08-21';
  const rows = [
    ['vlsfo', 'BM', '2026-08', 'USD/MT', 'asia_moc'], ['vlsfo', 'M1', '2026-09', 'USD/MT', 'asia_moc'], ['vlsfo', 'M2', '2026-10', 'USD/MT', 'asia_moc'],
    ['hsfo380', 'M1', '2026-09', 'USD/MT', 'london_moc'], ['hsfo380', 'M2', '2026-10', 'USD/MT', 'london_moc'],
    ['lsmgo', 'BM', '2026-08', 'USD/BBL', 'london_moc'], ['lsmgo', 'M1', '2026-09', 'USD/BBL', 'london_moc'], ['lsmgo', 'M2', '2026-10', 'USD/BBL', 'london_moc'],
  ].map(([productKey, tenor, contractMonth, unit, assessmentSession]) => ({ productKey, tenor, contractMonth, unit, assessmentSession, reportDate: latestDate, qualityStatus: 'verified', marketFamily: 'forward', settlementBasis: 'outright' }));
  rows.push({ ...rows[1], contractMonth: '2026-08', reportDate: '2026-07-31' });
  const scopes = marketIntelligenceTradingInternals.requiredCurveShadowScopes({ asOfDate: latestDate, snapshot: rows });
  assert.equal(scopes.length, 8);
  assert.equal(scopes.some((scope) => scope.productKey === 'lsmgo' && scope.contractMonth === '2026-08'), true);
  assert.equal(scopes.some((scope) => scope.productKey === 'vlsfo' && scope.contractMonth === '2026-08' && scope.reviewedThrough === '2026-07-31'), false);
  const weekendScopes = marketIntelligenceTradingInternals.requiredCurveShadowScopes({ asOfDate: '2026-08-22', snapshot: rows.map((row) => ({ ...row, reportDate: latestDate })), sessionFreshness: Object.fromEntries(['vlsfo', 'hsfo380', 'lsmgo'].map((productKey) => [productKey, { expectedPublicationDate: latestDate }])) });
  assert.equal(weekendScopes.length, 8);
  const weekendCompleteness = marketIntelligenceTradingInternals.curveCompleteness(rows, ['vlsfo', 'hsfo380', 'lsmgo'], '2026-08-22');
  assert.equal(weekendCompleteness.complete, true);
  assert.ok(Object.values(weekendCompleteness.sessionFreshness).every((state) => state.state === 'current_prior_session'));
});

test('shadow projection reports real variance metrics instead of synthetic zero', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    publication_date: `2026-08-${String(index + 11).padStart(2, '0')}`,
    product_key: 'vlsfo', contract_month: '2026-09-01', unit: 'USD/MT', comparison_count: 1,
    mean_signed_variance: 2 + index, mean_absolute_variance: 2 + index, maximum_absolute_variance: 2 + index,
  })).filter((row) => marketPublicationEligible(row.publication_date, 'asia_moc'));
  const projection = marketIntelligenceTradingInternals.shadowProjection(rows, { minimum_publication_days: rows.length, revision: 1 });
  assert.equal(projection.varianceMetricsAvailable, true);
  assert.equal(projection.scopes[0].scope, 'vlsfo:2026-09-01:USD/MT');
  assert.equal(projection.scopes[0].productKey, 'vlsfo');
  assert.equal(projection.scopes[0].contractMonth, '2026-09');
  assert.equal(projection.scopes[0].unit, 'USD/MT');
  assert.equal(projection.scopes[0].assessmentSession, 'asia_moc');
  assert.equal(projection.scopes[0].reviewedThrough, rows.at(-1).publication_date);
  assert.ok(projection.scopes[0].meanSignedVariance > 0);
  assert.ok(projection.scopes[0].maximumAbsoluteVariance >= projection.scopes[0].meanAbsoluteVariance);
});

test('company shadow review returns all eight explicit scopes independently of chart filters', () => {
  const asOfDate = '2026-08-21';
  const observations = [
    ['vlsfo', 'BM', '2026-08', 'USD/MT', 'asia_moc'], ['vlsfo', 'M1', '2026-09', 'USD/MT', 'asia_moc'], ['vlsfo', 'M2', '2026-10', 'USD/MT', 'asia_moc'],
    ['hsfo380', 'M1', '2026-09', 'USD/MT', 'london_moc'], ['hsfo380', 'M2', '2026-10', 'USD/MT', 'london_moc'],
    ['lsmgo', 'BM', '2026-08', 'USD/BBL', 'london_moc'], ['lsmgo', 'M1', '2026-09', 'USD/BBL', 'london_moc'], ['lsmgo', 'M2', '2026-10', 'USD/BBL', 'london_moc'],
  ].map(([productKey, tenor, contractMonth, unit, assessmentSession], index) => ({
    id: `observation-${index}`,
    productKey,
    tenor,
    contractMonth,
    unit,
    assessmentSession,
    reportDate: asOfDate,
    qualityStatus: 'verified',
    marketFamily: 'forward',
    settlementBasis: 'outright',
    publicationEligible: true,
    value: 500 + index,
  }));
  const shadowRows = observations.map((row) => ({
    publication_date: asOfDate,
    product_key: row.productKey,
    contract_month: `${row.contractMonth}-01`,
    unit: row.unit,
    comparison_count: 1,
    mean_signed_variance: 1,
    mean_absolute_variance: 1,
    maximum_absolute_variance: 1,
  }));
  shadowRows.push({ ...shadowRows[0], contract_month: '2026-07-01' });

  const projection = marketIntelligenceTradingInternals.companyShadowProjection(
    observations,
    [],
    shadowRows,
    { minimum_publication_days: 10, revision: 3 },
    asOfDate,
  );

  assert.equal(projection.scopes.length, 8);
  assert.ok(projection.scopes.every((scope) => scope.productKey && scope.contractMonth && scope.unit && scope.reviewedThrough === asOfDate));
  assert.equal(projection.scopes.some((scope) => scope.contractMonth === '2026-07'), false);
  assert.deepEqual(
    projection.scopes.filter((scope) => scope.productKey === 'lsmgo').map((scope) => scope.unit),
    ['USD/BBL', 'USD/BBL', 'USD/BBL'],
  );
});

test('driver lifecycle uses distinct report dates rather than brief revisions', () => {
  const rows = [
    { id: 'r2', report_date: '2026-08-20', revision: 2 },
    { id: 'r1', report_date: '2026-08-20', revision: 1 },
    { id: 'p2', report_date: '2026-08-19', revision: 2 },
    { id: 'p1', report_date: '2026-08-19', revision: 1 },
    { id: 'o1', report_date: '2026-08-18', revision: 1 },
  ];
  assert.deepEqual(marketIntelligenceTradingInternals.latestBriefsByReportDate(rows).map((row) => row.id), ['r2', 'p2', 'o1']);
});

test('stale history cannot republish an old curve regime flip under a new report date', async () => {
  const published = [];
  const curve = {
    history: [
      { date: '2026-08-18', productKey: 'vlsfo', regime: 'contango', headlineSlope: -5, unit: 'USD/MT', sourceRefs: [{ reportId: 'r1', seriesId: 's1' }] },
      { date: '2026-08-19', productKey: 'vlsfo', regime: 'backwardation', headlineSlope: 5, unit: 'USD/MT', sourceRefs: [{ reportId: 'r2', seriesId: 's1' }] },
      { date: '2026-08-20', productKey: 'vlsfo', regime: 'backwardation', headlineSlope: 6, unit: 'USD/MT', sourceRefs: [{ reportId: 'r3', seriesId: 's1' }] },
    ], outrightHistory: [], premiumMoves: [], premiumMoveHistory: [], warnings: [],
  };
  await marketIntelligenceTradingInternals.publishNumericAlerts({ rpc: async (name, payload) => { published.push(payload); return { data: { created: true }, error: null }; } }, '2026-08-21', {
    enabled: true, gasoilFloorUsdBbl: 1, spreadFloorUsdMt: 5, outrightFloorUsdMt: 10, minimumSamples: 20, percentile: 0.95, lookbackDays: 60, curveDeadbandUsdBbl: 0.25, curveDeadbandUsdMt: 2,
  }, 1, curve, []);
  assert.equal(published.some((row) => row.p_alert_type === 'curve_regime_flip'), false);
});

test('alert-rule save executes without consulting unrelated fallback variables', async () => {
  const client = {
    rpc: async (name) => ({
      data: name === 'save_market_intelligence_alert_rules'
        ? { enabled: true, revision: 2, outright_floor_usd_mt: 10, spread_floor_usd_mt: 5, gasoil_floor_usd_bbl: 1, percentile: 0.95, lookback_days: 60, minimum_samples: 20, curve_deadband_usd_mt: 2, curve_deadband_usd_bbl: 0.25 }
        : null,
      error: null,
    }),
  };
  const saved = await saveMarketIntelligenceAlertRules(client, { id: '00000000-0000-0000-0000-000000000001', email: 'gm@example.com' }, {
    rules: { enabled: true, outrightFloorUsdMt: 10, spreadFloorUsdMt: 5, gasoilFloorUsdBbl: 1, percentile: 0.95, lookbackDays: 60, minimumSamples: 20, curveDeadbandUsdMt: 2, curveDeadbandUsdBbl: 0.25 },
    expectedRevision: 1,
    idempotencyKey: 'alert-rules-1234567890',
  });
  assert.equal(saved.revision, 2);
});

test('hourly expected-session scan publishes a deduplicated stale London alert even without a new Drive file', async () => {
  const published = [];
  const query = (table) => {
    const filters = {};
    const builder = {
      select: () => builder,
      eq: (field, value) => { filters[field] = value; return builder; },
      in: () => builder,
      order: () => builder,
      limit: async () => ({ data: table === 'market_intelligence_alert_events' ? [] : table === 'market_price_observations' && filters.assessment_session === 'asia_moc' ? [{ id: 'asia' }] : [], error: null }),
      single: async () => ({ data: { id: 'company', enabled: true, revision: 1 }, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: table === 'market_report_imports' ? [{ id: 'eum', source_document_type: 'european_marketscan' }, { id: 'bw', source_document_type: 'bunkerwire' }] : [], error: null }).then(resolve, reject),
    };
    return builder;
  };
  const client = {
    from: query,
    rpc: async (name, payload) => {
      if (name === 'publish_market_intelligence_alert') published.push(payload);
      return { data: { created: true }, error: null };
    },
  };
  const result = await scanExpectedMarketSessions(client, { now: new Date('2026-08-21T21:00:00Z') });
  assert.equal(result.evaluated, 2);
  assert.equal(result.published, 1);
  assert.equal(published[0].p_alert_type, 'stale_london_moc_session');
});

test('fixed data-quality alerts remain enabled when adaptive alerts are disabled', async () => {
  const published = [];
  const client = {
    from: (table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        single: async () => ({ data: { id: 'company', enabled: false, revision: 3 }, error: null }),
      };
      return builder;
    },
    rpc: async (name, payload) => { published.push({ name, payload }); return { data: { created: true }, error: null }; },
  };
  const result = await publishMarketDataQualityAlert(client, { reportDate: '2026-08-21', code: 'MISSING_REPORT', title: 'Missing report', message: 'Expected report is absent.', severity: 'critical' });
  assert.equal(result.created, true);
  assert.equal(published[0].name, 'publish_market_intelligence_alert');
});

test('migration provides service-only governed market-intelligence storage and demotes old holiday canonicals', () => {
  const migration = read('supabase/migrations/20260820175956_platts_market_intelligence.sql');
  for (const table of ['market_forward_fallback_marks', 'market_intelligence_briefs', 'market_intelligence_brief_items', 'market_intelligence_alert_rules', 'market_intelligence_alert_events', 'market_intelligence_alert_notification_states', 'market_curve_shadow_runs', 'market_curve_shadow_control', 'market_intelligence_operations']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /NON_PUBLICATION_DAY_REPRINT/g);
  assert.match(migration, /set quality_status='quarantined'/i);
  assert.match(migration, /observation_unit/i);
  assert.match(migration, /contract_month/i);
  assert.match(migration, /assessment_session/i);
  assert.match(migration, /jsonb_array_length\(v_expected_scopes\)<>8/i);
  assert.match(migration, /market_is_reviewed_publication_date/i);
  assert.match(migration, /v_supplied_scopes<>v_expected_scopes/i);
  assert.match(migration, /generate_series\(v_scope\.reviewed_through::date-45/i);
  assert.match(migration, /mean_signed_variance/i);
  assert.match(migration, /save_market_curve_shadow_cutover\(bigint,boolean,text,uuid,text,text,text,jsonb\)/i);
  assert.match(migration, /record_market_curve_shadow\(date,text,date,text,integer,text,text,text,numeric,numeric,numeric\)/i);
  assert.match(migration, /expire_market_forward_fallbacks_for_report\(date\)/i);
});

test('the reviewed SGO midpoint parser correction is exact, fail closed, and audit preserving', () => {
  const migration = read('supabase/migrations/20260820181345_correct_20250805_sgo_midpoint.sql');
  assert.match(migration, /market_parser_correction_events/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]*public, anon, authenticated/i);
  assert.match(migration, /5b4652df928a6d479d3bcc8bf47f377d127a704005bc0873c77322b4f59ced23/);
  assert.match(migration, /v_evidence\.price<>89\.390000/);
  assert.match(migration, /set price=89\.410000,day_change=0\.000000/);
  assert.match(migration, /set sgo=89\.410000/);
  assert.match(migration, /SOURCE_MIDPOINT_PARSER_CORRECTION/);
  assert.match(migration, /MARKET_20250805_CORRECTION_PRECONDITION_FAILED/);
});

test('five authenticated handler names and fail-closed policies are wired', () => {
  const handler = read('api/functions/[name].js');
  const policy = read('api/_handlerPolicyRegistry.js');
  for (const name of ['marketIntelligenceBrief', 'marketIntelligenceCurve', 'marketForwardFallbackSave', 'marketIntelligenceAlertRulesGet', 'marketIntelligenceAlertRulesSave', 'marketIntelligenceCurveCutoverSave']) {
    assert.match(handler, new RegExp(`\\b${name}\\b`));
    assert.match(policy, new RegExp(`\\b${name}:`));
  }
  assert.match(policy, /marketForwardFallbackSave: mutationPolicy\([^\n]+hedge_book_manage/);
  assert.match(policy, /marketIntelligenceAlertRulesSave: mutationPolicy\([^\n]+hedge_admin/);
  assert.match(policy, /marketIntelligenceCurveCutoverSave: mutationPolicy\([^\n]+hedge_admin/);
  assert.match(read('supabase/migrations/20260820175956_platts_market_intelligence.sql'), /save_market_curve_shadow_cutover/);
});
