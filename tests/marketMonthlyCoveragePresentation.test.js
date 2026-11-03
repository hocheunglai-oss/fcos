import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('book context exposes accessible total, delivery and pricing quantity views', () => {
  const source = read('src/components/markets/MarketBookContext.jsx');
  assert.match(source, /\['total', 'Total quantities'\]/);
  assert.match(source, /\['delivery', 'Delivery months'\]/);
  assert.match(source, /\['pricing', 'Pricing months'\]/);
  assert.match(source, /role="tablist" aria-label="Book quantity views"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /if \(historical\) return/);
});

test('monthly coverage is filterable, bounded and explicit about allocation limits', () => {
  const source = read('src/components/markets/MarketMonthlyCoverage.jsx');
  assert.match(source, /Monthly coverage filters/);
  assert.match(source, /Product/);
  assert.match(source, /Counterparty/);
  assert.match(source, /Month/);
  assert.match(source, /filteredRows\.slice\(0, DEFAULT_VISIBLE_ROWS\)/);
  assert.match(source, /Delivery windows spanning more than one month remain unallocated/);
  assert.match(source, /Different months and bases are never netted/);
  assert.match(source, /Unallocated basis/);
  assert.match(source, /No quantity is inferred from unavailable allocation inputs/);
});

test('pricing coverage presents server quantities without claiming price-risk effectiveness', () => {
  const source = read('src/components/markets/MarketMonthlyCoverage.jsx');
  for (const field of ['physicalBuyFloatingQty', 'physicalSellFloatingQty', 'buyHedgeQty', 'sellHedgeQty', 'fixedBuyQty', 'fixedSellQty', 'physicalNet', 'hedgeNet', 'residualNet', 'uncoveredQty', 'excessHedgeQty']) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /Positive/);
  assert.match(source, /Negative/);
  assert.match(source, /A zero residual does not mean there is no price risk/);
  assert.match(source, /not P&amp;L or hedge-effectiveness evidence/);
  assert.match(source, /<details className="market-monthly-coverage__fixed">/);
});
