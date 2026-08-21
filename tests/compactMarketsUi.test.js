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

test('Overview and Pulse share compact product rows with accessible movement and distinct curve colors', () => {
  const brief = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  const css = read('src/hedge/views/market-intelligence/marketIntelligence.css');
  assert.match(brief, /Product<\/span><span>Latest MOPS<\/span><span>Published move/);
  assert.match(brief, /Est\. month average/);
  assert.match(brief, /BM−M1/);
  assert.match(brief, /M1−M2/);
  assert.match(brief, /MarketSignedValue/);
  assert.match(pulse, /sm:grid-cols-\[1\.25fr_1fr_1fr_1\.2fr\]/);
  assert.match(pulse, /MarketSignedValue/);
  assert.match(pulse, /backwardation: 'bg-violet-50/);
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
  const shellCss = read('src/index.css');
  const pulse = read('src/components/market-pulse/MarketPulse.jsx');
  const shared = read('src/components/markets/MarketSignedValue.jsx');
  const signedCss = read('src/components/markets/MarketSignedValue.css');
  const workspace = read('src/hedge/views/MarketIntelligenceWorkspace.jsx');
  const intraday = read('src/hedge/views/market-intelligence/MarketIntradayStrip.jsx');
  const drivers = read('src/hedge/views/market-intelligence/MarketDriversAlerts.jsx');
  assert.match(layout, /app-market-pulse-dock pointer-events-none absolute right-0 top-0/);
  assert.doesNotMatch(layout, /app-market-pulse-dock[^\n]*\bh-(?:10|14)\b/);
  assert.match(layout, /relative min-h-0 flex-1/);
  assert.match(layout, /z-30/);
  assert.match(layout, /env\(safe-area-inset-top\)/);
  assert.match(shellCss, /app-workspace-content--market-pulse \.app-page-header/);
  assert.match(shellCss, /market-overview-context/);
  assert.match(shellCss, /market-chart-controls--sticky/);
  assert.match(pulse, /max-h-\[calc\(100dvh-24px\)\]/);
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
  assert.match(page, /if \(!force && snapshotRequestRef\.current\) return snapshotRequestRef\.current/);
  assert.match(workspace, /if \(value === 'delivered'\) ensureMarketData\(\)/);
  assert.match(handler, /Capabilities are attached after the shared 60-second market-data cache resolves/);
  assert.match(handler, /hedge_book_manage: capabilities\?\.hedge_book_manage === true/);
  assert.match(handler, /hedge_admin: capabilities\?\.hedge_admin === true/);
});
