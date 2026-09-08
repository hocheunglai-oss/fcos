import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../src/components/dashboard/DashboardAnalytics.jsx', import.meta.url), 'utf8');

test('unified chart uses paired actual bars and a distinctive earth-tone palette', () => {
  assert.match(component, /dataKey="currentGrossProfit" name="Current gross profit" fill="#a94f2d"/);
  assert.match(component, /dataKey="priorGrossProfit" name="Prior-year gross profit" fill="#d8a47f"/);
  assert.match(component, /dataKey="currentVolume" name="Current volume" fill="#4f6b4f"/);
  assert.match(component, /dataKey="priorVolume" name="Prior-year volume" fill="#a8b69a"/);
  assert.doesNotMatch(component, /setMode\(|Monthly volume<\/button>/);
});

test('chart assigns profit, volume, and monthly margin to three color-coded labelled axes', () => {
  assert.match(component, /yAxisId="profit"/);
  assert.match(component, /yAxisId="volume" orientation="right"/);
  assert.match(component, /yAxisId="margin" orientation="right"/);
  assert.match(component, /label=\{\{ value: `\$\{currency\} GP`/);
  assert.match(component, /label=\{\{ value: 'MT'/);
  assert.match(component, /label=\{\{ value: '%'/);
  assert.match(component, /dataKey="currentGrossMarginPct" name="Current gross margin %" stroke="#7a4b5c"/);
  assert.match(component, /dataKey="priorGrossMarginPct" name="Prior-year gross margin %" stroke="#b88a96"[^>]+strokeDasharray="6 4"/);
  assert.match(component, /<span>Gross margin<\/span>/);
});

test('month labels and tooltip pair current/prior actuals and retain product detail', () => {
  assert.match(component, /<MonthComparisonTick rowsByMonth=\{rowsByMonth\}/);
  assert.match(component, /monthLabel\(row\?\.priorMonth\)/);
  assert.match(component, /Current products/);
  assert.match(component, /Prior-year products/);
  assert.match(component, /prior-year series are shown as gaps/);
});

test('prior-year chart data can be hidden and restored from an in-chart label button', () => {
  assert.match(component, /useState\(false\)/);
  assert.match(component, /aria-pressed=\{showPriorYear\}/);
  assert.match(component, /Prior year · \{showPriorYear \? 'Shown' : 'Hidden'\}/);
  assert.match(component, /showPriorYear \? <Bar yAxisId="profit" dataKey="priorGrossProfit"/);
  assert.match(component, /showPriorYear \? <Bar yAxisId="volume" dataKey="priorVolume"/);
  assert.match(component, /showPriorYear \? <Line yAxisId="margin"[^>]+dataKey="priorGrossMarginPct"/);
});

test('chart provides methodology, an accessible scroll container, and complete account names', () => {
  assert.match(component, /aria-label="How monthly chart values are calculated"/);
  assert.match(component, /Monthly chart methodology/);
  assert.match(component, /Missing or incomplete values remain unavailable rather than being shown as zero/);
  assert.match(component, /overflow-x-auto[^>]+tabIndex=\{0\}[^>]+aria-label=\{`\$\{currency\} monthly gross profit/);
  assert.match(component, /Current gross profit · \{currency\}/);
  assert.match(component, /Prior-year gross margin %/);
  assert.doesNotMatch(component, /title=\{row\.name\}/);
  assert.match(component, /break-words text-left/);
});
