import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  projectBriefDriver,
  projectMaterialChange,
  projectPhysicalPaperSignal,
  projectPortDislocation,
} from '../src/hedge/views/market-intelligence/briefProjection.js';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Markets opens on a four-view Platts-aligned daily decision brief', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  assert.match(workspace, /value: 'brief', label: 'Daily Decision Brief'/);
  assert.match(workspace, /value: 'delivered', label: 'Delivered & MOPS'/);
  assert.match(workspace, /value: 'curves', label: 'Forward Curves'/);
  assert.match(workspace, /value: 'drivers', label: 'Drivers & Alerts'/);
  assert.match(workspace, /useState\(initialMarketTab\)/);
  assert.match(workspace, /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(workspace, /visitedTabs/);
  assert.match(workspace, /hidden=\{tab !== 'curves'\}/);
  assert.match(workspace, /<MarketsView embedded showLegacyForward=\{false\}/);
  assert.match(workspace, /const \[mode, setMode\] = useState\('price'\)/);
  assert.match(workspace, /key === 'singapore'\) \? \['singapore'\]/);
  assert.match(workspace, /const \[includeMops, setIncludeMops\] = useState\(true\)/);
  assert.doesNotMatch(workspace, /aria-label="Forward Curves"><CargoForwardSummary/);
  assert.doesNotMatch(workspace, /aria-label="Drivers and Alerts"><MarketDriversAlerts[^\n]*<TradingSignals/);
  assert.ok(workspace.indexOf("value: 'hsfo380'") < workspace.indexOf("value: 'vlsfo'"));
  assert.ok(workspace.indexOf("value: 'vlsfo'") < workspace.indexOf("value: 'lsmgo'"));
});

test('forward curve UI requires exact outright fallback identity and shows controlled expiry', () => {
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  assert.match(curves, /Exact contract-month snapshot/);
  assert.match(curves, /contractMonth/);
  assert.match(curves, /outrightValue: Number\(form\.outrightPrice\)/);
  assert.match(curves, /sourceNote/);
  assert.doesNotMatch(curves, /fallbackRevision|expectedRevision: revision/);
  assert.match(curves, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(curves, /expires on the next verified report, next Platts publication day, or contract roll/);
  assert.match(curves, /connectNulls=\{false\}/);
  assert.match(curves, /Independent \{unit\} scale/);
  assert.match(curves, /syncId="forward-structure"/);
  assert.match(curves, /syncId="cross-market-context"/);
  assert.match(curves, /\['USD\/MT', 'USD\/BBL'\]/);
  assert.match(curves, /Legacy per-product forward adjustments are no longer trading inputs/);
  assert.match(curves, /row\.source/);
  assert.match(curves, /row\.expiresOn/);
  assert.match(curves, /isFallback \? 'authorized_fallback'/);
  assert.match(curves, /fallback \? 'Authorized fallback'[^:]+: row\?\.isPriorReport \? 'Prior report' : 'Verified report'/);
  assert.match(curves, /Source date \{formatDate\(row\.asOfDate\)\}/);
});

test('brief and alert views remain evidence-only and source-linked', () => {
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const alerts = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  assert.match(brief, /No buy or sell recommendation/);
  assert.match(brief, /Report page/);
  assert.match(brief, /Emerging/);
  assert.match(brief, /Persistent/);
  assert.match(brief, /Fading/);
  assert.match(alerts, /previous 60-day 95th percentile/);
  assert.match(alerts, /at least 20 samples/);
  assert.match(alerts, /lookbackDays/);
  assert.match(alerts, /curveDeadbandUsdBbl/);
  assert.match(alerts, /percentile: 0\.95/);
  assert.match(alerts, /Saving changes the company-wide in-app threshold policy/);
});

test('daily brief renders exact deterministic backend metrics with figures and basis', () => {
  const move = projectMaterialChange({
    productKey: 'vlsfo',
    tenor: 'M1',
    contractMonth: '2026-09-01',
    change: 12.5,
    unit: 'USD/MT',
    sourceSymbol: 'AAOAJ00',
    sourceRefs: [{ sourceHash: 'report-1', page: 3 }],
  });
  assert.equal(move.title, 'S0.5% M1 daily move');
  assert.equal(move.summary, 'The exact Sept 2026 M1 outright moved +12.50 USD/MT.');
  assert.equal(move.metricBasis, 'AAOAJ00 · Sept 2026 · M1 · report daily change');
  assert.equal(move.sourceRefs[0].sourceHash, 'report-1');

  const ports = projectPortDislocation({ productKey: 'hsfo380', lowPort: 'PPXDK00', highPort: 'AAXJQ00', dispersion: 24.75, unit: 'USD/MT', sampleCount: 4 });
  assert.equal(ports.title, 'HSFO 380 delivered-port dispersion');
  assert.equal(ports.summary, 'AAXJQ00 was +24.75 USD/MT above PPXDK00 across 4 same-date assessed ports.');
  assert.equal(ports.metricBasis, 'Same-date assessed delivered prices');

  const signal = projectPhysicalPaperSignal({ productKey: 'lsmgo', reportDate: '2026-08-21', state: 'divergent', physicalMove: -11, paperMove: 14.9, unit: 'USD/MT', originalPaperMove: 2, originalPaperUnit: 'USD/BBL', conversionFactor: 7.45 });
  assert.equal(signal.title, 'LSMGO physical versus M1 paper · Divergent');
  assert.equal(signal.summary, 'Delivered assessments moved −11.00 USD/MT on average; exact M1 paper moved +14.90 USD/MT (+2.000 USD/BBL × 7.45).');
  assert.match(signal.metricBasis, /2026-08-21 · same-date delivered average vs exact M1 paper/);

  const unavailable = projectPhysicalPaperSignal({ productKey: 'hsfo380', state: 'unavailable', reportDate: '2026-08-21' });
  assert.match(unavailable.summary, /makes no relationship inference/);
});

test('brief drivers project exact product, port, and numeric confidence fields', () => {
  const driver = projectBriefDriver({ productKey: 'vlsfo', portKey: 'singapore', confidence: 0.86, sourceRefs: [{ sourceHash: 'report-2', page: 5 }] });
  assert.equal(driver.product, 'vlsfo');
  assert.equal(driver.port, 'singapore');
  assert.equal(driver.confidenceLabel, '86% confidence');
  assert.equal(driver.sourceRefs[0].page, 5);
});

test('report import review exposes units and contract identity before approval', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  assert.match(workspace, /row\.unit \|\| 'Unit unavailable'/);
  assert.match(workspace, /row\.printedContractMonth \|\| row\.contractMonth/);
  assert.match(workspace, /row\.assessmentSession/);
  assert.match(workspace, /importBlockers\.length > 0/);
  assert.match(workspace, /publicationEligible !== false/);
  assert.match(workspace, /Non-publication reprint · evidence only/);
});

test('brief projections understand the authenticated backend DTO without hiding evidence', () => {
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const drivers = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  assert.match(brief, /completeness\.complete === true \? requiredReports/);
  assert.match(brief, /regimeLabel\(row\)/);
  assert.match(brief, /Array\.isArray\(drivers\)/);
  assert.match(brief, /sourceRefs/);
  assert.match(brief, /ref\.sourceHash && top\.sourceHash === ref\.sourceHash/);
  assert.match(brief, /ref\.reportType \|\| ref\.documentType/);
  assert.match(brief, /formatDate\(ref\.reportDate \|\| defaultDate\)/);
  assert.match(drivers, /if \(Array\.isArray\(source\)\)/);
  assert.match(drivers, /ref\.sourceHash && top\.sourceHash === ref\.sourceHash/);
  assert.match(drivers, /events: result\?\.events\?\.length \? result\.events : current\?\.events \|\| \[\]/);
  assert.match(curves, /row\.settlementBasis, row\.tenor, row\.contractMonth, row\.sourceSymbol/);
});

test('market data and alert-rule permissions remain separate', () => {
  const page = read('src/pages/Markets.jsx');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  assert.match(page, /canManageMarketData=\{snapshot\.capabilities\?\.hedge_book_manage === true\}/);
  assert.match(page, /canManageAlertRules=\{snapshot\.capabilities\?\.hedge_admin === true\}/);
  assert.match(page, /canManageCurveCutover=\{snapshot\.capabilities\?\.hedge_admin === true\}/);
  assert.match(read('api/_hedgeDeskService.js'), /capabilities:\s*\{[\s\S]*?hedge_book_manage:[\s\S]*?hedge_admin:/);
  assert.match(workspace, /<MarketDriversAlerts readOnly=\{!canManageAlertRules\}/);
  assert.match(workspace, /<MarketForwardCurves readOnly=\{!canManageMarketData\} canManageCutover=\{canManageCurveCutover\}/);
});

test('curve cutover review is hedge-admin-only, auditable, and fail closed', () => {
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  assert.match(curves, /loadMarketIntelligenceCurve\(\{ products: PRODUCTS\.map\(\(item\) => item\.value\), range \}/);
  assert.match(curves, /PRODUCTS\.filter\(\(product\) => selectedProducts\.includes\(product\.value\)\)/);
  assert.match(curves, /useEffect\(\(\) => \{ load\(\); \}, \[range\]\)/);
  assert.match(curves, /shadow\.status === 'ready_for_variance_review'/);
  assert.match(curves, /shadow\.varianceMetricsAvailable === true/);
  assert.match(curves, /cutoverScopes\.length === 8/);
  assert.match(curves, /cutoverScopeIdentities\.size === 8/);
  assert.match(curves, /PRODUCTS\.every\(\(product\) => cutoverScopeProducts\.has\(product\.value\)\)/);
  assert.match(curves, /Chart product buttons do not narrow this required eight-scope review/);
  assert.match(curves, /Approval requires exactly eight unique scopes across HSFO 380, S0\.5% and LSMGO/);
  assert.match(curves, /meanSignedVariance/);
  assert.match(curves, /meanAbsoluteVariance/);
  assert.match(curves, /maximumAbsoluteVariance/);
  assert.match(curves, /scope\.reviewedThrough/);
  assert.match(curves, /cutoverReason\.trim\(\)\.length >= 8/);
  assert.match(curves, /expectedRevision: cutoverRevision/);
  assert.match(curves, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(curves, /canManageCutover && !cutoverApproved/);
  assert.match(curves, /Fail closed: current and future hedge valuation remains on the legacy calculation/);
});

test('Markets API exposes separate authenticated intelligence handlers', () => {
  const marketData = read('src/hedge/api/marketData.js');
  for (const handler of [
    'marketIntelligenceBrief',
    'marketIntelligenceCurve',
    'marketForwardFallbackSave',
    'marketIntelligenceAlertRulesGet',
    'marketIntelligenceAlertRulesSave',
    'marketIntelligenceCurveCutoverSave',
    'marketIntelligenceArchiveReplay',
  ]) assert.match(marketData, new RegExp(`'${handler}'`));
  assert.match(marketData, /invalidateCache: true/);
});

test('licensed archive reconciliation is administrator-only, batched, and no-refresh', () => {
  const drivers = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  const dispatcher = read('api/functions/[name].js');
  const policies = read('api/_handlerPolicyRegistry.js');
  assert.match(drivers, /if \(result\.complete\) break/);
  assert.match(drivers, /result\.nextCursor/);
  assert.match(drivers, /855-file manifest/);
  assert.match(drivers, /PDF bytes and report prose are never stored/);
  assert.match(dispatcher, /marketIntelligenceArchiveReplay[\s\S]*requireCapability\([\s\S]*'hedge_admin'/);
  assert.match(dispatcher, /runMarketReportArchiveReplayBatch/);
  assert.match(policies, /marketIntelligenceArchiveReplay: mutationPolicy\(\{"cache":"none","externalAction":true,"capability":"hedge_admin"\}\)/);
});

test('Markets methodology removes adjustment-based pricing', () => {
  const methodology = read('src/hedge/lib/methodology.js');
  assert.match(methodology, /exact report outright for each printed contract month/);
  assert.match(methodology, /balance-month outright to remaining publication days including its assessment date/);
  assert.match(methodology, /Legacy per-product adjustments are not trading inputs/);
  assert.doesNotMatch(methodology, /latest actual spot MOPS plus the saved product adjustment/);
});
