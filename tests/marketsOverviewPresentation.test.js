import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('full market board leads with three comparable metrics and moves estimates and curves into secondary detail', () => {
  const source = read('src/components/markets/MarketPriceBoard.jsx');
  const css = read('src/components/markets/MarketPriceBoard.css');
  assert.match(source, /Primary market price comparison/);
  assert.match(source, /Latest MOPS<\/span><span>Previous publication change<\/span><span>Singapore delivered/);
  assert.match(source, /<details className="market-price-board__secondary">/);
  assert.match(source, /Month estimates &amp; forward structure/);
  assert.match(source, /Month estimates and forward structure/);
  assert.match(css, /market-price-board__primary-header[^}]*grid-template-columns: minmax\(130px, \.76fr\)[^}]*minmax\(230px, 1\.2fr\)/);
  assert.doesNotMatch(css, /market-price-board__primary-header[^}]*grid-template-columns:[^}]*repeat\(8/);
});

test('source health is scoped and never suppresses the valid board', () => {
  const source = read('src/components/markets/MarketPriceBoard.jsx');
  assert.match(source, /SourceHealthNotice sourceHealth=\{pulse\?\.sourceHealth\}/);
  assert.match(source, /The displayed valid market data remains available/);
  assert.match(source, /Latest publication/);
  assert.match(source, /Current source status/);
  assert.match(source, /Last successful import/);
  assert.match(source, /sourceHealth\.message/);
  assert.match(source, /const unit = delivered\.unit \|\| 'USD\/MT'/);
  assert.match(source, /allowProductSourceFallback: false/);
  assert.match(source, /publicationDate: comparison\.currentDate/);
  assert.match(source, /comparison\.available \? comparison\.sourceSampleCount \?\? 2/);
  assert.match(source, /value: comparison\.available \? comparison\.change : null/);
  assert.doesNotMatch(source, /sourceHealth[^\n]*\? null/);
});

test('accessible book context is quantity-only, unit-preserving, bounded, and historical-safe', () => {
  const source = read('src/components/markets/MarketBookContext.jsx');
  assert.match(source, /const DEFAULT_VISIBLE_ROWS = 5/);
  assert.match(source, /contextRows\.slice\(0, DEFAULT_VISIBLE_ROWS\)/);
  assert.match(source, /Products remain in their native units and are never summed across units/);
  assert.match(source, /Quantity difference/);
  assert.match(source, /Math\.abs\(numeric\)/);
  assert.match(source, /Number\(row\.netExposure\) >= 0 \? 'uncovered' : 'excess hedge'/);
  assert.match(source, /value == null \|\| String\(value\)\.trim\(\) === ''/);
  assert.match(source, /row\?\.hedgeRatio == null/);
  assert.match(source, /to="\/hedge-desk\?tab=physical"/);
  assert.match(source, /to="\/hedge-desk\?tab=hedges"/);
  assert.match(source, /Current book quantities are hidden for this historical snapshot/);
  assert.doesNotMatch(source, /P&L|\bprofit\b|\bloss\b|\bbuy\b|\bsell\b|\blong\b/i);
});

test('overview brief selects at most three deterministic developments and keeps complete detail expandable', () => {
  const source = read('src/hedge/views/market-intelligence/MarketDecisionBrief.jsx');
  assert.match(source, /function selectWhatMatters\(groups, limit = 3\)/);
  assert.match(source, /selected\.length < limit/);
  assert.match(source, /onNavigateMarketView\(view\)/);
  assert.match(source, /view: 'drivers', viewLabel: 'research & alerts'/);
  assert.match(source, /canReadBook \? <MarketBookContext/);
  assert.match(source, /historical=\{dateMode === 'historical'\}/);
  assert.match(source, /className="market-brief-detail"/);
  assert.match(source, /Published price moves/);
  assert.match(source, /Delivered-port evidence/);
  assert.match(source, /Physical and paper evidence/);
  assert.match(source, /Drivers and risks/);
  assert.doesNotMatch(source, /threshold-ranked/);
});
