import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/markets/MarketPriceBoard.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/markets/MarketPriceBoard.css', import.meta.url), 'utf8');

test('shared market board keeps the governed product order and optional Singapore delivered column', () => {
  assert.match(source, /const PRODUCT_ORDER = \['hsfo380', 'vlsfo', 'lsmgo'\]/);
  assert.match(source, /singaporeDelivered/);
  assert.match(source, /lsmgo: 'LSMGO'/);
  assert.match(source, /\$\{productLabel\(product\)\} Singapore delivered price/);
  assert.doesNotMatch(source, /product\.productName\} Singapore delivered price/);
  assert.match(source, /!compact \? <SingaporeDelivered/);
  assert.match(source, /export function MarketPriceBoard\(\{ pulse, compact = false \}\)/);
});

test('market board preserves native units, current versus historical labels, and traceable metric detail', () => {
  assert.match(source, /String\(unit \|\| ''\)\.toUpperCase\(\) === 'USD\/BBL' \? 3 : 2/);
  assert.match(source, /Reconstructed month estimate · as of/);
  assert.match(source, /currently stored records dated on or before the selected date; later corrections may differ/);
  assert.match(source, /sampleCount/);
  assert.match(source, /represented publication day/);
  assert.match(source, /Source sample count/);
  assert.match(source, /Source sample count', metric\?\.sourceSampleCount[\s\S]*?recordCount/);
  assert.doesNotMatch(source, /Source sample count', [^\n]*countedDays/);
  assert.match(source, /Source code/);
  assert.match(source, /Read-only evidence for the displayed market metric/);
  assert.match(source, /onCloseAutoFocus=\{restoreMetricFocus\}/);
});

test('market board provides a responsive desktop table and readable mobile product cards', () => {
  assert.match(css, /\.market-price-board__desktop \{ overflow-x: auto; \}/);
  assert.match(css, /min-width: 1120px/);
  assert.match(css, /market-price-board-panel--compact[\s\S]*min-width: 800px/);
  assert.match(css, /minmax\(128px, \.64fr\)/);
  assert.match(css, /minmax\(128px, \.62fr\)/);
  assert.match(css, /\.market-price-board__mobile \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 720px\).*?\.market-price-board__desktop \{ display: none; \}.*?\.market-price-board__mobile \{ display: grid;[^}]*\}/s);
  assert.match(css, /\.market-price-board__price[^}]*font-size: 15px/);
  assert.match(css, /\.market-price-board__regime--backwardation[^}]*#6d28d9/);
  assert.match(css, /\.market-price-board__regime--contango[^}]*#92400e/);
  assert.match(css, /@media \(max-width: 389px\) \{ \.market-price-board__card-grid \{ grid-template-columns: 1fr; \}/);
});
