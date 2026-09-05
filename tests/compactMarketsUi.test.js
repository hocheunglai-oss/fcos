import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Markets uses the compact four-tab reading flow and keeps governed tools separate', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  assert.match(workspace, /label: 'Overview'/);
  assert.match(workspace, /label: 'Delivered prices'/);
  assert.match(workspace, /label: 'Forward curves'/);
  assert.match(workspace, /label: 'Research & alerts'/);
  assert.match(workspace, /title="Market tools"/);
  assert.match(workspace, /Licensed reports/);
  assert.match(workspace, /Settlement MOPS control/);
  assert.match(workspace, /Forward fallbacks and curve cutover/);
  assert.match(workspace, /Alert rules and archive reconciliation/);
  assert.doesNotMatch(workspace, /<CargoForwardSummary intelligence=/);
  assert.doesNotMatch(workspace, /<TradingSignals intelligence=/);
});

test('Overview and Pulse share one accessible product board with compact Pulse rendering', () => {
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const board = read('src/components/markets/MarketPriceBoard.jsx');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  const css = read('src/hedge/views/market-intelligence/marketIntelligence.css');
  assert.match(brief, /MarketPriceBoard pulse=\{\{ \.\.\.pulse, mode: dateMode \}\}/);
  assert.match(board, /export function MarketPriceBoard\(\{ pulse, compact = false \}\)/);
  assert.match(board, /<span>Product<\/span><span>Latest MOPS<\/span><span>Published move<\/span>/);
  assert.match(board, /Singapore delivered/);
  assert.match(board, /Reconstructed month estimate/);
  assert.match(board, /BM−M1/);
  assert.match(board, /M1−M2/);
  assert.match(board, /MarketSignedValue/);
  assert.match(pulse, /<MarketPriceBoard pulse=\{data\} compact \/>/);
  assert.doesNotMatch(css, /market-price-board__row \{ display: grid; grid-template-columns:[\s\S]*?min-width: 1080px/);
  assert.match(pulse, /MarketSignedValue/);
  assert.match(board, /backwardation: 'market-price-board__regime--backwardation'/);
  assert.match(css, /market-curve-state--backwardation/);
  assert.match(css, /market-curve-state--contango/);
});

test('intraday, evidence, cell statistics, and chart selections stay available without permanent scroll', () => {
  const intraday = read('src/hedge/views/market-intelligence/MarketIntradayStrip.jsx');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  const styles = read('src/hedge/styles.css');
  assert.match(intraday, /market-intraday-rail/);
  assert.match(intraday, /Official MOPS unchanged/);
  assert.match(intraday, /expanded/);
  assert.match(workspace, /three-month premium or discount sparkline/i);
  assert.match(workspace, /<HorizonStat label="1W"/);
  assert.match(workspace, /fcos:markets:delivered:v1/);
  assert.match(curves, /fcos:markets:curves:v1/);
  assert.match(curves, /function CurveMovement/);
  assert.match(curves, /MarketSignedAxisTick/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /market-mobile-product-tabs/);
});

test('Pulse floats without a full-width row and signed values share one renderer', () => {
  const layout = read('src/components/Layout.jsx');
  const draggable = read('src/components/workspace/DraggableWorkspaceUtility.jsx');
  const shellCss = read('src/index.css');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  const shared = read('src/components/markets/MarketSignedValue.jsx');
  const signedCss = read('src/components/markets/MarketSignedValue.css');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const intraday = read('src/hedge/views/market-intelligence/MarketIntradayStrip.jsx');
  const drivers = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  assert.match(layout, /<DraggableWorkspaceUtility/);
  assert.match(draggable, /app-market-pulse-dock absolute z-40/);
  assert.doesNotMatch(layout, /app-market-pulse-dock[^\n]*\bh-(?:10|14)\b/);
  assert.match(layout, /relative min-h-0 flex-1/);
  assert.match(draggable, /ResizeObserver/);
  assert.match(draggable, /workspace-safe-area-top/);
  assert.match(draggable, /MARKET_PULSE_POSITION_STORAGE_KEY/);
  assert.match(draggable, /window\.setTimeout\(\(\) => \{[\s\S]*suppressClickRef\.current = false/);
  assert.doesNotMatch(shellCss, /app-workspace-content--market-pulse/);
  assert.match(shellCss, /app-workspace-scroll > :first-child/);
  assert.match(shellCss, /max-width: 1600px/);
  assert.match(pulse, /max-h-\[calc\(100dvh-24px\)\]/);
  assert.match(pulse, /app-market-pulse-trigger h-9 w-9 shrink-0 p-0/);
  assert.doesNotMatch(pulse, />Pulse<\/span>/);
  assert.doesNotMatch(shellCss, /margin-inline-end:\s*5rem/);
  assert.match(shared, /market-signed-value--\$\{tone\}/);
  assert.match(shared, /TrendingUp/);
  assert.match(shared, /TrendingDown/);
  assert.match(signedCss, /market-signed-value--up[^{]*\{[^}]*#087447/);
  assert.match(signedCss, /market-signed-value--down[^{]*\{[^}]*#c02632/);
  assert.match(workspace, /MarketSignedValue/);
  assert.match(intraday, /MarketSignedValue/);
  assert.match(drivers, /MarketSignedText/);
});

test('initial Markets load is Pulse-only and user capabilities are appended after the shared cache', () => {
  const page = read('src/pages/Markets.jsx');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const handler = read('api/functions/[name].js');
  assert.match(page, /await loadMarketPulseSnapshot/);
  assert.match(page, /const ensureSnapshot = useCallback/);
  assert.match(page, /snapshotRequestRef\.current\?\.key === key/);
  assert.match(page, /workspace-floating-utility-safe/);
  assert.doesNotMatch(workspace, /if \(value === 'delivered'\) ensureMarketData/);
  assert.match(handler, /Capabilities are attached after the shared 60-second market-data cache resolves/);
  assert.match(handler, /hedge_book_manage: capabilities\?\.hedge_book_manage === true/);
  assert.match(handler, /hedge_admin: capabilities\?\.hedge_admin === true/);
});

test('one date controller keeps visible Markets panels on the same historical as-of date', () => {
  const page = read('src/pages/Markets.jsx');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const curves = read('src/hedge/views/market-intelligence/MarketForwardCurves.jsx');
  const intraday = read('src/hedge/views/market-intelligence/MarketIntradayStrip.jsx');
  assert.match(workspace, /marketBriefMode/);
  assert.match(workspace, /date && params\.get\('marketBriefMode'\) !== 'latest'/);
  assert.match(workspace, /window\.addEventListener\('popstate'/);
  assert.match(workspace, /setTab\(nextTab\)/);
  assert.match(workspace, /<MarketDateToolbar/);
  assert.match(workspace, /onBriefError=\{resolveBriefError\}/);
  assert.match(workspace, /endDate: asOfDate/);
  assert.match(workspace, /historyError && !history/);
  assert.match(workspace, /historyRetryKey/);
  assert.match(workspace, /asOfDate=\{displayedDate \|\| null\}/);
  assert.match(page, /loadMarketPulseSnapshot\(\{ asOfDate \}/);
  assert.match(curves, /asOfDate = null/);
  assert.match(intraday, /asOfDate = null/);
});

test('MOPS mutations refresh both the Pulse and the governed settlement snapshot', () => {
  const page = read('src/pages/Markets.jsx');
  const marketApi = read('src/hedge/api/marketData.js');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  assert.match(page, /const reloadAfterMarketMutation = useCallback/);
  assert.match(page, /reload\(\{ silent: true, force: true \}\)/);
  assert.match(page, /ensureSnapshot\(\{ force: true \}\)/);
  assert.match(page, /refreshVersion=\{refreshVersion\}/);
  assert.match(page, /<ActionsProvider reload=\{reloadAfterMarketMutation\}>/);
  assert.match(marketApi, /fcos:market-pulse-changed/);
  assert.match(pulse, /window\.addEventListener\('fcos:market-pulse-changed'/);
  assert.match(pulse, /if \(open\) load\(\{ force: true \}\)/);
});

test('global date refresh works outside Overview and latest resolution avoids a second brief request', () => {
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const api = read('src/hedge/api/marketData.js');
  assert.doesNotMatch(brief, /if \(!active\) return/);
  assert.match(workspace, /requestedDate=\{dateSelection.mode === 'historical' \? dateSelection.date : null\}/);
  assert.match(workspace, /active=\{tab === 'curves' && dateReady\}/);
  assert.match(workspace, /refreshVersionRef.current === refreshVersion/);
  assert.match(api, /const \{ asOfDate, \.\.\.legacyOptions \} = payload/);
  assert.match(api, /const requestOptions = \{ \.\.\.legacyOptions, \.\.\.options \}/);
});
