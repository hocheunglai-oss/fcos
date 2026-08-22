import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dashboard uses the shared native workspace surfaces without changing its data handlers', async () => {
  const [page, filters, kpis] = await Promise.all([
    read('src/pages/DashboardSettings.jsx'),
    read('src/components/dashboard/DashboardFilterBar.jsx'),
    read('src/components/dashboard/DashboardKpis.jsx'),
  ]);
  assert.match(page, /workspace-page workspace-dashboard/);
  assert.match(filters, /app-navigation-material workspace-filter-rail/);
  assert.match(filters, /workspace-filter-panel/);
  assert.match(kpis, /workspace-kpi-card/);
  assert.doesNotMatch(kpis, /glass-surface/);
  assert.match(page, /dashboardSummary/);
  assert.match(page, /AccountInsightModal/);
});

test('Account Insight is a concentric native detail window with opaque financial surfaces', async () => {
  const [modal, css] = await Promise.all([
    read('src/components/dashboard/AccountInsightModal.jsx'),
    read('src/index.css'),
  ]);
  assert.match(modal, /account-insight-window/);
  assert.match(modal, /account-insight-toolbar/);
  assert.match(modal, /account-insight-section/);
  assert.match(modal, /material-table/);
  assert.match(modal, /app-navigation-material sticky top-0/);
  assert.match(css, /\.account-insight-canvas/);
  assert.match(css, /\.material-table tbody tr:hover/);
});
