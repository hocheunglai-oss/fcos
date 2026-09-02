import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every live Hedge Desk valuation surface consumes the governed market snapshot', () => {
  const overview = read('src/hedge/views/OverviewView.jsx');
  const physical = read('src/hedge/views/PhysicalView.jsx');
  const hedges = read('src/hedge/views/HedgesView.jsx');
  const settlement = read('src/hedge/views/SettlementView.jsx');
  const domain = read('src/hedge/lib/domain.js');
  const assistant = read('src/hedge/components/AssistantPanel.jsx');

  assert.match(overview, /governedValuation: data\.marketValuation/);
  assert.match(overview, /buildExposureRows\([\s\S]*data\.marketValuation/);
  assert.match(physical, /calcPhysicalPnl\([^\n]+data\.marketValuation\)/);
  assert.match(hedges, /calcSwapMtm\([^\n]+data\.marketValuation\)/);
  assert.match(settlement, /settlementSummary\([^\n]+data\.marketValuation\)/);
  assert.match(settlement, /buildCounterpartySettlementGroups\([^\n]+data\.marketValuation, data\.counterparties\)/);
  assert.match(domain, /mtm: mtm == null \? null : roundMoney\(mtm\)/);
  assert.match(settlement, /Settlement document generation is blocked until every hedge has a governed market value/);
  assert.match(assistant, /calcSwapMtm\([^\n]+data\.marketValuation\)/);
});

test('active governed valuation never accepts a monthly scalar or silently zeroes missing points', () => {
  const domain = read('src/hedge/lib/domain.js');
  assert.match(domain, /governedValuation\.valuationPoints/);
  assert.doesNotMatch(domain, /Number\(settlement\.value\)/);
  assert.match(domain, /governedRecords === null\) return null/);
  assert.match(domain, /governedValuation\?\.mode === "platts_curve_active" && \(!leg1 \|\| !leg2\)/);
  assert.match(domain, /unrealizedMtm = valuationAvailable \?/);
});
