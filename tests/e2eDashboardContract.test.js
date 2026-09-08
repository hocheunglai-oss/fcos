import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Dashboard E2E selects the rendered Account Insight credit tab', async () => {
  const [dashboardE2e, accountInsightModal] = await Promise.all([
    readFile(new URL('../e2e/dashboard.spec.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountInsightModal.jsx', import.meta.url), 'utf8'),
  ]);
  const renderedCreditTab = accountInsightModal.match(/<TabsTrigger value="credit">([^<]+)<\/TabsTrigger>/)?.[1]?.replace(/&amp;/g, '&');
  const activeTabSelectors = [...dashboardE2e.matchAll(/page\.getByRole\('tab', \{ name: '([^']+)', exact: true \}\)\)\.toHaveAttribute\('data-state', 'active'\)/g)].map((match) => match[1]);

  assert.equal(renderedCreditTab, 'Credit & Payments');
  assert.ok(activeTabSelectors.includes(renderedCreditTab));
  assert.doesNotMatch(dashboardE2e, /getByRole\('tab', \{ name: 'Credit Statement'/);
});
