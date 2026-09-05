import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dashboardPeriodLabel, dashboardDisplayNumber } from '../src/lib/dashboardPresentation.js';

test('compact period labels preserve disjoint months and years without widening the selection', () => {
  assert.equal(dashboardPeriodLabel([2026], [1, 2, 3, 4, 5, 6, 7, 8, 9]), 'Jan–Sep 2026');
  assert.equal(dashboardPeriodLabel([2026], [9]), 'Sep 2026');
  assert.equal(dashboardPeriodLabel([2026, 2025], [1, 3, 5]), 'Jan, Mar, May 2025, 2026');
  assert.equal(dashboardPeriodLabel([2026], [3, 1, 2, 2]), 'Jan–Mar 2026');
  assert.equal(dashboardPeriodLabel([2026], Array.from({ length: 12 }, (_, i) => i + 1)), 'Jan–Dec 2026');
});

test('missing and incomplete display values never become financial zero', () => {
  for (const value of [null, undefined, '', '   ', NaN, Infinity, false, 'unavailable']) assert.equal(dashboardDisplayNumber(value), null);
  assert.equal(dashboardDisplayNumber(0), 0);
  assert.equal(dashboardDisplayNumber('0.00'), 0);
  assert.equal(dashboardDisplayNumber('-125.50'), -125.5);
});

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
test('Dashboard uses one compact control panel and hides only the irrelevant Accounts trading perspective', async () => {
  const [page, filters, css] = await Promise.all([source('src/pages/DashboardSettings.jsx'), source('src/components/dashboard/DashboardFilterBar.jsx'), source('src/index.css')]);
  assert.doesNotMatch(page, /<DashboardSavedViews/);
  assert.equal((filters.match(/<DashboardSavedViews/g) || []).length, 1);
  assert.match(page, /showPerspective=\{tab !== 'accounts'\}/);
  assert.doesNotMatch(filters, /-mx-|sm:w-\[27rem\]|sm:w-48/);
  assert.match(filters, /aria-controls="dashboard-filter-controls"/);
  assert.match(page, /new ResizeObserver\(measure\)/);
  assert.match(css, /top: calc\(var\(--dashboard-header-height/);
  assert.match(css, /@container dashboard/);
  assert.match(page, /insightScrollContainerRef.current\?\.scrollTop \?\? window.scrollY/);
});

test('trading figures lead, currencies appear once and incomplete KPI evidence is withheld', async () => {
  const kpis = await source('src/components/dashboard/DashboardKpis.jsx');
  const labels = [...kpis.matchAll(/<FinancialCard[^\n]+label="([^"]+)"/g)].map((item) => item[1]);
  assert.deepEqual(labels, ['Gross Profit', 'Gross Margin %', 'Turnover']);
  assert.match(kpis, /aria-label="Trading activity"/);
  assert.match(kpis, /complete \? number\(row\[field\]\) : null/);
  assert.doesNotMatch(kpis, /style: 'currency'|glass-surface/);
  assert.match(kpis, /!percent \|\| rows.length > 1/);
});
