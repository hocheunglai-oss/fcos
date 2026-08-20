import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptiveAlertThreshold,
  contractMonthForTenor,
  evaluateCurveShadow,
  exactOutrightForContract,
  manualFallbackExpiry,
  projectedMopsSettlement,
  sameSnapshotSignals,
  shiftContractMonth,
} from '../shared/plattsMarketModel.js';
import { applyReplay, buildMarketArchiveAudit, buildMarketReplayImpact, publishableMopsTriple } from '../scripts/replay-market-report-archive.mjs';
import { buildExposureRows, buyingPower, calcPhysicalPnl, calcSwapMtm, settlementSummary, tradingDaysInMonth } from '../src/hedge/lib/domain.js';

test('contract tenors resolve by report month while printed contract identity remains authoritative', () => {
  assert.equal(shiftContractMonth('2026-12', 1), '2027-01');
  assert.equal(contractMonthForTenor({ reportDate: '2026-08-19', tenor: 'BM' }), '2026-08');
  assert.equal(contractMonthForTenor({ reportDate: '2026-08-19', tenor: 'M1', printedContractMonth: '2026-09' }), '2026-09');
  assert.equal(contractMonthForTenor({ reportDate: '2026-08-19', tenor: 'M2', printedContractMonth: '2026-09' }), '2026-09');
  assert.equal(contractMonthForTenor({ reportDate: '2026-08-19', tenor: 'M1', printedContractMonth: 'not-a-month' }), null);
});

test('balance-month settlement includes the assessment day and all remaining publication days', () => {
  const result = projectedMopsSettlement({
    contractMonth: '2026-08',
    asOfDate: '2026-08-19',
    publicationDays: ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'],
    actuals: [
      { date: '2026-08-17', value: 700 },
      { date: '2026-08-18', value: 710 },
      { date: '2026-08-19', value: 999 },
    ],
    balanceMonthValue: 720,
  });
  assert.deepEqual(result, {
    available: true,
    value: 714,
    source: 'balance_month_projection',
    contractMonth: '2026-08',
    actualDays: 2,
    projectedDays: 3,
    totalPublicationDays: 5,
    balanceMonthValue: 720,
  });
});

test('balance-month settlement fails closed on a missing prior publication actual', () => {
  const result = projectedMopsSettlement({
    contractMonth: '2026-08',
    asOfDate: '2026-08-19',
    publicationDays: ['2026-08-17', '2026-08-18', '2026-08-19'],
    actuals: [{ date: '2026-08-17', value: 700 }],
    balanceMonthValue: 720,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'prior_actuals_incomplete');
  assert.deepEqual(result.missingDates, ['2026-08-18']);
});

test('closed months use only approved actual averages and future months require exact outrights', () => {
  assert.deepEqual(projectedMopsSettlement({ contractMonth: '2026-07', asOfDate: '2026-08-19', approvedActualAverage: 612.125 }), {
    available: true, value: 612.125, source: 'approved_actual', contractMonth: '2026-07',
  });
  assert.equal(projectedMopsSettlement({ contractMonth: '2026-07', asOfDate: '2026-08-19' }).reason, 'closed_month_not_approved');
  assert.equal(projectedMopsSettlement({ contractMonth: '2026-09', asOfDate: '2026-08-19' }).reason, 'future_month_requires_outright');
});

test('future M1 and M2 use distinct exact contract-month outrights', () => {
  const observations = [
    { id: 'm1', product: 'vlsfo', marketFamily: 'forward', contractMonth: '2026-09', value: 684.05, unit: 'USD/MT', qualityStatus: 'verified', reportDate: '2026-08-19' },
    { id: 'm2', product: 'vlsfo', marketFamily: 'forward', contractMonth: '2026-10', value: 649.55, unit: 'USD/MT', qualityStatus: 'verified', reportDate: '2026-08-19' },
  ];
  assert.equal(exactOutrightForContract({ product: 'vlsfo', contractMonth: '2026-09', observations }).value, 684.05);
  assert.equal(exactOutrightForContract({ product: 'vlsfo', contractMonth: '2026-10', observations }).value, 649.55);
  assert.equal(exactOutrightForContract({ product: 'vlsfo', contractMonth: '2026-11', observations }).reason, 'exact_outright_missing');
  assert.equal(exactOutrightForContract({ product: 'vlsfo', contractMonth: '2026-09', asOfDate: '2026-08-18', observations }).reason, 'exact_outright_missing');
  assert.equal(exactOutrightForContract({ product: 'lsmgo', contractMonth: '2026-09', observations: [{ ...observations[0], product: 'lsmgo' }] }).reason, 'exact_outright_missing');
});

test('manual outright fallback expires on the next Platts publication day, report, or contract roll', () => {
  const mark = { asOfDate: '2026-08-19', contractMonth: '2026-09' };
  assert.deepEqual(manualFallbackExpiry(mark, { nextPublicationDate: '2026-08-20', today: '2026-08-19' }), {
    active: true, reason: null, expiresOn: '2026-08-20',
  });
  assert.deepEqual(manualFallbackExpiry(mark, { nextPublicationDate: '2026-08-20', today: '2026-08-20' }), {
    active: false, reason: 'next_publication_day', expiresOn: '2026-08-20',
  });
  assert.equal(manualFallbackExpiry(mark, { verifiedReportDate: '2026-08-20', today: '2026-08-20' }).reason, 'verified_report_available');
  assert.equal(manualFallbackExpiry(mark, { nextContractRollDate: '2026-08-25', today: '2026-08-25' }).reason, 'contract_rolled');
});

test('same-snapshot structure and cross-grade signals never mix reports', () => {
  const base = { reportId: 'report-1', reportDate: '2026-08-19', sourceHash: 'hash-1' };
  const signals = sameSnapshotSignals([
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'BM', contractMonth: '2026-08', value: 733.25 },
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M1', contractMonth: '2026-09', value: 684.05 },
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M2', contractMonth: '2026-10', value: 649.55 },
    { ...base, product: 'hsfo380', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M1', contractMonth: '2026-09', value: 573 },
    { ...base, product: 'hsfo380', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M2', contractMonth: '2026-10', value: 534.25 },
    { ...base, product: 'lsmgo', marketFamily: 'context', unit: 'USD/MT', tenor: 'M1', contractMonth: '2026-09', value: 999 },
  ]);
  assert.equal(signals.products.vlsfo.regime, 'backwardation');
  assert.equal(signals.products.vlsfo.bmM1, 49.2);
  assert.equal(signals.products.vlsfo.m1M2, 34.5);
  assert.equal(signals.crossGrade.m1, 111.05);
  assert.equal(sameSnapshotSignals([
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'BM', contractMonth: '2026-08', value: 690 },
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M1', contractMonth: '2026-09', value: 680 },
    { ...base, product: 'vlsfo', marketFamily: 'forward', unit: 'USD/MT', tenor: 'M2', contractMonth: '2026-10', value: 685 },
  ]).products.vlsfo.regime, 'mixed');
  assert.equal(sameSnapshotSignals([{ ...base, product: 'vlsfo', tenor: 'M1', value: 1 }, { ...base, reportId: 'report-2', product: 'vlsfo', tenor: 'M2', value: 2 }]).reason, 'same_snapshot_required');
});

test('exact outrights never reuse an older report after the latest snapshot drops that tenor', () => {
  const observations = [
    { id: 'older', product: 'vlsfo', marketFamily: 'forward', contractMonth: '2026-10', value: 649.55, unit: 'USD/MT', qualityStatus: 'verified', reportDate: '2026-08-18' },
    { id: 'latest-other-tenor', product: 'vlsfo', marketFamily: 'forward', contractMonth: '2026-09', value: 684.05, unit: 'USD/MT', qualityStatus: 'verified', reportDate: '2026-08-19' },
  ];
  assert.equal(exactOutrightForContract({ product: 'vlsfo', contractMonth: '2026-10', asOfDate: '2026-08-19', observations }).reason, 'exact_outright_missing');
  assert.equal(exactOutrightForContract({
    product: 'vlsfo', contractMonth: '2026-10', asOfDate: '2026-08-19', observations,
    fallbacks: [{ id: 'expired', product: 'vlsfo', contractMonth: '2026-10', unit: 'USD/MT', value: 650, status: 'active', asOfDate: '2026-08-17', expiresOn: '2026-08-19' }],
  }).reason, 'exact_outright_missing');
});

test('adaptive alert threshold uses a 20-sample P95 with a configured floor', () => {
  assert.equal(adaptiveAlertThreshold(Array.from({ length: 19 }, (_, index) => index + 1), 10), 10);
  assert.equal(adaptiveAlertThreshold(Array.from({ length: 20 }, (_, index) => index + 1), 5), 19);
  assert.equal(adaptiveAlertThreshold(Array.from({ length: 20 }, () => 1), 10), 10);
});

test('curve cutover remains blocked after ten publication days until variance review', () => {
  const result = evaluateCurveShadow(Array.from({ length: 10 }, (_, index) => ({
    publicationDate: `2026-08-${String(index + 3).padStart(2, '0')}`,
    product: 'vlsfo',
    contractMonth: '2026-09',
    legacyValue: 680,
    curveValue: 681 + index,
  })));
  assert.equal(result.status, 'ready_for_variance_review');
  assert.equal(result.publicationDayCount, 10);
  assert.equal(result.cutoverApproved, false);
  assert.equal(result.meanAbsoluteVariance, 5.5);
  assert.equal(result.maximumAbsoluteVariance, 10);
  const expected = Array.from({ length: 11 }, (_, index) => `2026-08-${String(index + 3).padStart(2, '0')}`);
  const missingSession = evaluateCurveShadow(Array.from({ length: 10 }, (_, index) => ({
    publicationDate: expected[index + (index >= 4 ? 1 : 0)],
    product: 'vlsfo', contractMonth: '2026-09', legacyValue: 680, curveValue: 681,
  })), 10, { expectedPublicationDays: expected });
  assert.equal(missingSession.status, 'shadowing');
  assert.equal(missingSession.consecutiveCompletePublicationDayCount, 6);
  assert.deepEqual(missingSession.missingExpectedDays, ['2026-08-07']);
});

test('curve shadow readiness is evaluated for every product-contract-unit series', () => {
  const days = Array.from({ length: 10 }, (_, index) => `2026-08-${String(index + 3).padStart(2, '0')}`);
  const comparisons = [
    ...days.map((publicationDate) => ({ publicationDate, product: 'vlsfo', contractMonth: '2026-09', unit: 'USD/MT', legacyValue: 680, curveValue: 681 })),
    ...days.slice(1).map((publicationDate) => ({ publicationDate, product: 'lsmgo', contractMonth: '2026-09', unit: 'USD/BBL', legacyValue: 90, curveValue: 91 })),
  ];
  const result = evaluateCurveShadow(comparisons, 10, { expectedPublicationDays: days });
  assert.equal(result.status, 'shadowing');
  assert.equal(result.series.length, 2);
  assert.equal(result.consecutiveCompletePublicationDayCount, 9);
});

test('archive impact distinguishes complete source files from unique canonical reports', () => {
  const report = {
    documentType: 'european_marketscan',
    reportDate: '2026-08-19',
    sourceHash: 'a'.repeat(64),
    observations: [
      { sourceSymbol: 'AMFSA00', price: 746.97 },
      { sourceSymbol: 'PPXDK00', price: 611.9 },
      { sourceSymbol: 'POABC00', price: 165.92 },
    ],
  };
  const impact = buildMarketReplayImpact({
    discoveredFiles: 2,
    inspectedSourceFiles: 2,
    completeEuropeanMarketscanSourceFiles: 2,
    duplicateFiles: 1,
    parseFailures: [],
    reports: [report],
  }, new Map());
  assert.equal(impact.completeEuropeanMarketscanSourceFiles, 2);
  assert.equal(impact.completeEuropeanMarketscanTriples, 1);
  assert.equal(impact.uniqueReports, 1);
  assert.equal(impact.duplicateFiles, 1);
  const audit = buildMarketArchiveAudit({
    discoveredFiles: 2,
    inspectedSourceFiles: 2,
    completeEuropeanMarketscanSourceFiles: 2,
    duplicateFiles: 1,
    parseFailures: [],
    sourceFileReports: [report, report],
    reports: [report],
  });
  assert.match(audit.manifestHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(audit.contractMonthIssues, []);
  assert.deepEqual(audit.uniqueByType, { bunkerwire: 0, european_marketscan: 1 });
  assert.equal(audit.sourceFileSymbolCounts.AMFSA00, 2);
  assert.equal(audit.uniqueReportSymbolCounts.AMFSA00, 1);
  const missingDuplicate = buildMarketArchiveAudit({
    discoveredFiles: 1,
    inspectedSourceFiles: 1,
    completeEuropeanMarketscanSourceFiles: 1,
    duplicateFiles: 0,
    parseFailures: [],
    sourceFileReports: [report],
    reports: [report],
  });
  assert.notEqual(missingDuplicate.manifestHash, audit.manifestHash);
});

test('archive apply gate validates every explicit forward and context contract family', () => {
  const row = (sourceSymbol, contractMonth, printedContractMonth, tenor, unit, assessmentSession) => ({
    sourceSymbol, price: 1, contractMonth, printedContractMonth, tenor, unit, assessmentSession,
    basisMetadata: { publicationEligible: true },
  });
  const report = {
    documentType: 'european_marketscan', reportDate: '2026-08-19', sourceHash: 'c'.repeat(64), observations: [
      row('FOFS000', '2026-08-01', '2026-08-01', 'bm', 'USD/MT', 'asia_moc'),
      row('FOFS001', '2026-09-01', '2026-09-01', 'm1', 'USD/MT', 'asia_moc'),
      row('FOFS002', '2026-10-01', '2026-10-01', 'm2', 'USD/MT', 'asia_moc'),
      row('FPLSM01', '2026-09-01', '2026-09-01', 'm1', 'USD/MT', 'london_moc'),
      row('FPLSM02', '2026-10-01', '2026-10-01', 'm2', 'USD/MT', 'london_moc'),
      row('FQLSM01', '2026-09-01', '2026-09-01', 'm1', 'USD/MT', 'london_moc'),
      row('FQLSM02', '2026-10-01', '2026-10-01', 'm2', 'USD/MT', 'london_moc'),
      row('BSGSL00', '2026-08-01', '2026-08-01', 'bm', 'USD/BBL', 'london_moc'),
      row('MSGSL00', '2026-09-01', '2026-09-01', 'm1', 'USD/BBL', 'london_moc'),
      row('MSHSL00', '2026-10-01', '2026-10-01', 'm2', 'USD/BBL', 'london_moc'),
      row('AARIN00', '2026-09-01', '2026-09-01', 'other', 'USD/MT', 'london_1630'),
      row('AARIO00', '2026-10-01', '2026-10-01', 'other', 'USD/MT', 'london_1630'),
      row('AARIP00', '2026-11-01', '2026-11-01', 'other', 'USD/MT', 'london_1630'),
      row('AAYES00', '2026-09-01', '2026-09-01', 'other', 'USD/BBL', 'london_1630'),
      row('AAYET00', '2026-10-01', '2026-10-01', 'other', 'USD/BBL', 'london_1630'),
      row('AAXZY00', '2026-11-01', '2026-11-01', 'other', 'USD/BBL', 'london_1630'),
      row('AAYAM00', '2026-12-01', '2026-12-01', 'other', 'USD/BBL', 'london_1630'),
      ...Array.from({ length: 6 }, (_, index) => row(`ICLO00${index + 1}`, `202${index < 4 ? 6 : 7}-${String(((8 + index) % 12) + 1).padStart(2, '0')}-01`, `202${index < 4 ? 6 : 7}-${String(((8 + index) % 12) + 1).padStart(2, '0')}-01`, 'other', 'USD/MT', 'ice_settlement')),
      row('MSJSL00', '2026-08-01', null, 'bm', 'USD/MT', 'london_1630'),
      row('MSKSL00', '2026-08-01', '2026-08-01', 'm0', 'USD/MT', 'london_1630'),
      row('MSLSL00', '2026-09-01', '2026-09-01', 'm1', 'USD/MT', 'london_1630'),
      row('MSMSL00', '2026-10-01', '2026-10-01', 'm2', 'USD/MT', 'london_1630'),
    ],
  };
  const audit = buildMarketArchiveAudit({ discoveredFiles: 1, inspectedSourceFiles: 1, duplicateFiles: 0, parseFailures: [], reports: [report] });
  assert.deepEqual(audit.contractMonthIssues, []);

  const invalid = structuredClone(report);
  invalid.observations.find((item) => item.sourceSymbol === 'FQLSM02').contractMonth = '2026-11-01';
  invalid.observations.find((item) => item.sourceSymbol === 'MSGSL00').unit = 'USD/MT';
  invalid.observations.find((item) => item.sourceSymbol === 'AARIO00').printedContractMonth = '2026-11-01';
  const invalidAudit = buildMarketArchiveAudit({ discoveredFiles: 1, inspectedSourceFiles: 1, duplicateFiles: 0, parseFailures: [], reports: [invalid] });
  assert.ok(invalidAudit.contractMonthIssues.some((issue) => issue.code === 'HSFO_OUTRIGHT_SPREAD_MONTH_MISMATCH'));
  assert.ok(invalidAudit.contractMonthIssues.some((issue) => issue.code === 'UNIT_MISMATCH'));
  assert.ok(invalidAudit.contractMonthIssues.some((issue) => issue.code === 'PRINTED_CONTRACT_MONTH_MISMATCH'));
});

test('stale session reprints remain evidence but cannot publish settlement MOPS', () => {
  const report = {
    documentType: 'european_marketscan',
    reportDate: '2025-05-01',
    sourceHash: 'b'.repeat(64),
    observations: ['AMFSA00', 'PPXDK00', 'POABC00'].map((sourceSymbol, index) => ({
      sourceSymbol,
      price: 600 + index,
      basisMetadata: { publicationEligible: false },
    })),
  };
  assert.equal(publishableMopsTriple(report), null);
  const impact = buildMarketReplayImpact({
    discoveredFiles: 1,
    inspectedSourceFiles: 1,
    completeEuropeanMarketscanSourceFiles: 1,
    duplicateFiles: 0,
    parseFailures: [],
    reports: [report],
  }, new Map());
  assert.equal(impact.completeEuropeanMarketscanTriples, 0);
  assert.deepEqual(impact.publicationIneligibleEuropeanMarketscanDates, ['2025-05-01']);
});

test('exposure valuation switches only after governed curve cutover and fails closed on a missing mark', () => {
  const swap = {
    id: 'swap-1', counterparty: 'Counterparty', product: 'S0.5', unit: 'MT', quantity: 100,
    direction: 'BUY', price: 620, swap_month: '2026-09', pricing_basis: 'WMA', trade_type: 'OUTRIGHT', is_expired: false,
  };
  const mops = [{ price_date: '2026-08-21', s05: 600, s380: 500, sgo: 80, is_estimate: false }];
  const shadow = buildExposureRows([], [swap], mops, 7.45, { s05: 10 }, { mode: 'legacy_active_curve_shadow', settlements: [] });
  assert.equal(shadow[0].swapMtm, -1000);

  const active = buildExposureRows([], [swap], mops, 7.45, { s05: 10 }, {
    mode: 'platts_curve_active',
    settlements: [{ productKey: 'vlsfo', contractMonth: '2026-09', available: true, authorizedForValuation: true }],
    valuationPoints: tradingDaysInMonth('2026-09').map((priceDate) => ({ priceDate, value: 650, source: 'verified_report', productKey: 'vlsfo', contractMonth: '2026-09', unit: 'USD/MT', period: 'future' })),
  });
  assert.equal(active[0].swapMtm, 3000);
  assert.equal(active[0].combinedPnl, 3000);

  const unavailable = buildExposureRows([], [swap], mops, 7.45, { s05: 10 }, { mode: 'platts_curve_active', settlements: [] });
  assert.equal(unavailable[0].swapMtm, null);
  assert.equal(unavailable[0].combinedPnl, null);
  assert.equal(unavailable[0].valuationWarnings[0].reason, 'governed_settlement_unavailable');
});

test('governed publication-day points price every hedge surface consistently and never accept a scalar-only mark', () => {
  const swap = {
    id: 'swap-1', product: 'S0.5', unit: 'MT', quantity: 100, direction: 'BUY', price: 620,
    swap_month: '2026-09', pricing_basis: 'WMA', trade_type: 'OUTRIGHT', is_expired: false,
  };
  const physical = {
    id: 'physical-1', product: 'S0.5', unit: 'MT', qty_min: 100, qty_max: 100,
    sell_price_type: 'Fixed', sell_price: 670, sell_pricing_month: '2026-09', sell_pricing_basis: 'WMA',
    buy_price_type: 'Fixed', buy_price: 630, buy_pricing_month: '2026-09', buy_pricing_basis: 'WMA',
  };
  const valuation = {
    mode: 'platts_curve_active',
    settlements: [{ productKey: 'vlsfo', contractMonth: '2026-09', available: true, authorizedForValuation: true }],
    valuationPoints: tradingDaysInMonth('2026-09').map((priceDate) => ({ priceDate, value: 650, source: 'verified_report', productKey: 'vlsfo', contractMonth: '2026-09', unit: 'USD/MT', period: 'future' })),
  };
  assert.equal(calcSwapMtm(swap, [], 7.45, valuation)?.value, 3000);
  assert.equal(calcPhysicalPnl(physical, [], 7.45, valuation)?.value, 4000);
  assert.equal(buyingPower({ swaps: [swap], mops: [], governedValuation: valuation }).unrealizedMtm, 3000);
  assert.equal(settlementSummary([swap], [], {}, '2026-09', 7.45, valuation).mtm, 3000);

  const scalarOnly = { ...valuation, valuationPoints: [] };
  assert.equal(calcSwapMtm(swap, [], 7.45, scalarOnly), null);
  assert.equal(calcPhysicalPnl(physical, [], 7.45, scalarOnly), null);
  assert.equal(buyingPower({ swaps: [swap], mops: [], governedValuation: scalarOnly }).unrealizedMtm, null);
  assert.equal(settlementSummary([swap], [], {}, '2026-09', 7.45, scalarOnly).mtm, null);

  const spreadWithMissingSecondMonth = {
    ...swap, trade_type: 'SPREAD', leg1_month: '2026-09', leg1_price: 620, leg1_basis: 'WMA',
    leg2_month: '2026-10', leg2_price: 630, leg2_basis: 'WMA',
  };
  assert.equal(calcSwapMtm(spreadWithMissingSecondMonth, [], 7.45, valuation), null);
  assert.equal(calcPhysicalPnl({ ...physical, buy_pricing_month: '2026-10' }, [], 7.45, valuation), null);
});

test('archive apply reports progress without an undefined loop counter', async () => {
  const calls = [];
  const client = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { status: 'completed', quarantinedCount: 0, mopsPublication: { status: 'matched' } }, error: null };
    },
  };
  const report = {
    sourceHash: 'a'.repeat(64), documentType: 'bunkerwire', reportDate: '2026-08-20', observations: [],
  };
  const result = await applyReplay(client, [report], new Map(), {});
  assert.equal(result.completed, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.derivedBriefs.pairedDates, 0);
  assert.equal(calls[0].name, 'save_market_report_import');
});
