import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  projectBriefDriver,
  projectMaterialChange,
  projectPhysicalPaperSignal,
  projectPortDislocation,
} from '../src/hedge/views/market-intelligence/briefProjection.js';
import { marketSymbolLabel } from '../src/hedge/lib/marketLabels.js';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Markets opens on a four-view Platts-aligned daily decision brief', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  assert.match(workspace, /value: 'brief', label: 'Overview'/);
  assert.match(workspace, /value: 'delivered', label: 'Delivered prices'/);
  assert.match(workspace, /value: 'curves', label: 'Forward curves'/);
  assert.match(workspace, /value: 'drivers', label: 'Research & alerts'/);
  assert.match(workspace, /useState\(initialMarketTab\)/);
  assert.match(workspace, /new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(workspace, /visitedTabs/);
  assert.match(workspace, /hidden=\{tab !== 'curves'\}/);
  assert.match(workspace, /<MarketsView embedded showLegacyForward=\{false\}/);
  assert.match(workspace, /initialFilters\.mode\) \? initialFilters\.mode : 'price'/);
  assert.match(workspace, /key === 'singapore'\) \? \['singapore'\]/);
  assert.match(workspace, /initialFilters\.includeMops !== false/);
  assert.match(workspace, /Market tools/);
  assert.match(workspace, /title="Market tools"[^\n]*width="xl"/);
  assert.match(workspace, /className="market-tools-embedded-workspace"/);
  assert.match(workspace, /mode="admin"/);
  assert.doesNotMatch(workspace, /aria-label="Forward Curves"><CargoForwardSummary/);
  assert.doesNotMatch(workspace, /aria-label="Drivers and Alerts"><MarketDriversAlerts[^\n]*<TradingSignals/);
  assert.ok(workspace.indexOf("value: 'hsfo380'") < workspace.indexOf("value: 'vlsfo'"));
  assert.ok(workspace.indexOf("value: 'vlsfo'") < workspace.indexOf("value: 'lsmgo'"));
});

test('Market Tools keeps embedded settlement controls inside the drawer', () => {
  const intelligenceStyles = read('src/hedge/views/market-intelligence/marketIntelligence.css');
  const appStyles = read('src/hedge/styles.css');
  assert.match(intelligenceStyles, /\.market-tools-section > div \{[^}]*min-width: 0;/);
  assert.match(intelligenceStyles, /\.market-tools-embedded-workspace > \.app-page \{ min-width: 0; padding: 0; \}/);
  assert.match(intelligenceStyles, /\.market-tools-embedded-workspace \.app-table-frame \{ min-width: 0; \}/);
  assert.match(appStyles, /\.app-drawer--xl \{\s*width: min\(1120px, 96vw\);/);
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
  assert.match(curves, /mode === 'admin'/);
  assert.match(curves, /row\.source/);
  assert.match(curves, /row\.expiresOn/);
  assert.match(curves, /isFallback \? 'authorized_fallback'/);
  assert.match(curves, /fallback \? 'Authorized fallback'[^:]+: row\?\.isPriorReport \? 'Prior report' : 'Verified report'/);
  assert.match(curves, /Source date \{formatDate\(row\.asOfDate\)\}/);
});

test('brief and alert views remain evidence-only and source-linked', () => {
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const alerts = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  assert.match(brief, /cannot change a price or create a trading recommendation/);
  assert.match(brief, /Report page/);
  assert.match(brief, /Emerging/);
  assert.match(brief, /Persistent/);
  assert.match(brief, /Fading/);
  assert.match(workspace, /marketBriefDate/);
  assert.match(workspace, />Previous</);
  assert.match(workspace, />Next</);
  assert.match(workspace, />Latest</);
  assert.match(workspace, /Latest available/);
  assert.match(brief, /Reports for the requested date are not available/);
  assert.match(brief, /Evidence & methodology/);
  assert.match(brief, /Show all/);
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
  assert.equal(move.metricBasis, 'S0.5% M1 outright (AAOAJ00) · Sept 2026 · report daily change');
  assert.equal(move.sourceRefs[0].sourceHash, 'report-1');

  const ports = projectPortDislocation({ productKey: 'hsfo380', lowPort: 'South Korea', lowPortSymbol: 'PUAFR00', highPort: 'Hong Kong', highPortSymbol: 'PUAER00', dispersion: 24.75, unit: 'USD/MT', sampleCount: 4 });
  assert.equal(ports.title, 'HSFO 380 delivered-port dispersion');
  assert.equal(ports.summary, 'Hong Kong HSFO 380 delivered (PUAER00) was +24.75 USD/MT above South Korea HSFO 380 delivered (PUAFR00) across 4 same-date assessed ports.');
  assert.equal(ports.metricBasis, 'Same-date assessed delivered prices');

  const signal = projectPhysicalPaperSignal({ productKey: 'lsmgo', reportDate: '2026-08-21', state: 'divergent', physicalMove: -11, paperMove: 14.9, unit: 'USD/MT', originalPaperMove: 2, originalPaperUnit: 'USD/BBL', conversionFactor: 7.45 });
  assert.equal(signal.title, 'LSMGO physical versus M1 paper · Divergent');
  assert.equal(signal.summary, 'Delivered assessments moved −11.00 USD/MT on average; exact M1 paper moved +14.90 USD/MT (+2.000 USD/BBL × 7.45).');
  assert.match(signal.metricBasis, /2026-08-21 · same-date delivered average vs exact M1 paper/);

  const unavailable = projectPhysicalPaperSignal({ productKey: 'hsfo380', state: 'unavailable', reportDate: '2026-08-21' });
  assert.match(unavailable.summary, /makes no relationship inference/);
});

test('Markets leads with human assessment names and retains Platts codes in brackets', () => {
  assert.equal(marketSymbolLabel('PUAER00'), 'Hong Kong HSFO 380 delivered (PUAER00)');
  assert.equal(marketSymbolLabel('FOFS001'), 'S0.5% M1 outright (FOFS001)');
  assert.equal(marketSymbolLabel('UNLISTED', { productKey: 'lsmgo', tenor: 'M2', marketFamily: 'forward' }), 'LSMGO M2 outright (UNLISTED)');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  assert.match(workspace, /marketSymbolLabel\(row\.sourceSymbol/);
  assert.match(workspace, /marketSymbolLabel\(benchmark\?\.sourceSymbol/);
  assert.match(curves, /marketSymbolLabel\(row\.sourceSymbol/);
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
  assert.match(brief, /requestedDate = null/);
  assert.match(brief, /onBriefResolved/);
  assert.match(brief, /MarketPriceBoard pulse=\{\{ \.\.\.pulse, mode: dateMode \}\}/);
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
  assert.match(page, /canManageMarketData=\{pulse\?\.capabilities\?\.hedge_book_manage === true\}/);
  assert.match(page, /canManageAlertRules=\{pulse\?\.capabilities\?\.hedge_admin === true\}/);
  assert.match(page, /canManageCurveCutover=\{pulse\?\.capabilities\?\.hedge_admin === true\}/);
  assert.match(read('api/_hedgeDeskService.js'), /capabilities:\s*\{[\s\S]*?hedge_book_manage:[\s\S]*?hedge_admin:/);
  assert.match(workspace, /<MarketDriversAlerts readOnly=\{!canManageAlertRules\} mode="admin"/);
  assert.match(workspace, /<MarketForwardCurves readOnly=\{!canManageMarketData\} canManageCutover=\{canManageCurveCutover\} mode="admin"/);
});

test('curve cutover review is hedge-admin-only, auditable, and fail closed', () => {
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  assert.match(curves, /loadMarketIntelligenceCurve\(\{ products: PRODUCTS\.map\(\(item\) => item\.value\), range, \.\.\.\(asOfDate/);
  assert.match(curves, /PRODUCTS\.filter\(\(product\) => selectedProducts\.includes\(product\.value\)\)/);
  assert.match(curves, /\}, \[active, asOfDate, range, refreshKey\]\)/);
  assert.match(curves, /shadow\.status === 'ready_for_variance_review'/);
  assert.match(curves, /shadow\.varianceMetricsAvailable === true/);
  assert.match(curves, /cutoverScopes\.length === 8/);
  assert.match(curves, /cutoverScopeIdentities\.size === 8/);
  assert.match(curves, /PRODUCTS\.every\(\(product\) => cutoverScopeProducts\.has\(product\.value\)\)/);
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
  assert.match(drivers, /const canResume = archiveProgress && archiveProgress\.complete !== true/);
  assert.match(drivers, /cursor = canResume \? Number\(archiveProgress\.nextCursor \|\| 0\) : 0/);
  assert.match(drivers, /archiveFingerprint = canResume \? archiveProgress\.archiveFingerprint \|\| null : null/);
  assert.doesNotMatch(drivers, /setArchiveProgress\(null\)/);
  assert.match(drivers, /unique reports reconciled/);
  assert.match(drivers, /byte duplicates retained as lineage/);
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

test('Markets methodology distinguishes the shared historical date from latest Pulse and represented publication days', () => {
  const methodology = read('src/hedge/lib/methodology.js');
  assert.match(methodology, /selected report date applies consistently to every Markets tab/);
  assert.match(methodology, /floating Market Pulse is intentionally latest-only/);
  assert.match(methodology, /currently stored MOPS rows dated on or before the selected report date/);
  assert.match(methodology, /Later corrections may therefore differ/);
  assert.match(methodology, /actual, estimated and carried counts plus represented publication days/);
  assert.match(methodology, /not a source-record sample count/);
  assert.match(methodology, /every available page for the selected range/);
  assert.match(methodology, /exact-date MOPS observation/);
});
