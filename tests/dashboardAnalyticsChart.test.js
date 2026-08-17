import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../src/components/dashboard/DashboardAnalytics.jsx', import.meta.url), 'utf8');

test('unified chart uses paired actual bars and a blue gross-profit legend', () => {
  assert.match(component, /dataKey="currentGrossProfit" name="Current gross profit" fill="#2563eb"/);
  assert.match(component, /dataKey="priorGrossProfit" name="Prior-year gross profit" fill="#93c5fd"/);
  assert.match(component, /dataKey="currentVolume" name="Current volume" fill="#0f766e"/);
  assert.match(component, /dataKey="priorVolume" name="Prior-year volume" fill="#99f6e4"/);
  assert.doesNotMatch(component, /setMode\(|Monthly volume<\/button>/);
});

test('chart assigns profit, volume, and monthly margin to three color-coded axes', () => {
  assert.match(component, /yAxisId="profit"/);
  assert.match(component, /yAxisId="volume" orientation="right"/);
  assert.match(component, /yAxisId="margin" orientation="right"/);
  assert.doesNotMatch(component, /label=\{\{ value: currency/);
  assert.doesNotMatch(component, /label=\{\{ value: 'MT'/);
  assert.doesNotMatch(component, /label=\{\{ value: '%'/);
  assert.match(component, /dataKey="currentGrossMarginPct" name="Current gross margin" stroke="#7c3aed"/);
  assert.match(component, /dataKey="priorGrossMarginPct" name="Prior-year gross margin" stroke="#a78bfa"[^>]+strokeDasharray="6 4"/);
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
