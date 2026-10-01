import { expect, test } from '@playwright/test';

const requestCount = (page) => page.evaluate(() => window.managementOverviewFixture.requests.length);
const requestAt = (page, index) => page.evaluate((target) => window.managementOverviewFixture.requests[target], index);
const resolve = (page, index, data) => page.evaluate(({ target, response }) => window.managementOverviewFixture.resolve(target, response), { target: index, response: data });

test.beforeEach(async ({ page, baseURL }) => {
  page.fixtureErrors = [];
  page.providerRequests = [];
  page.on('pageerror', (error) => page.fixtureErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') page.fixtureErrors.push(message.text()); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin || url.pathname.startsWith('/api/')) {
      page.providerRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Management Overview desktop fixture' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(page.fixtureErrors).toEqual([]);
  expect(page.providerRequests).toEqual([]);
});

test('read-only users manually load personal counts, preserve partial results on error, and see only scoped workspace links', async ({ page }) => {
  const overview = page.getByRole('region', { name: 'Management overview' });
  await expect(overview.getByText('Personal work counts have not been checked.', { exact: false })).toBeVisible();
  expect(await requestCount(page)).toBe(0);

  await expect(overview.getByRole('button', { name: 'Check my work', exact: true })).toBeVisible();
  await expect(overview.getByRole('link', { name: /My Commitments/ })).toHaveAttribute('href', '/my-commitments');
  await expect(overview.getByRole('link', { name: /Payment reconciliation/ })).toHaveAttribute('href', '/payment-collections?tab=reconciliation');
  await expect(overview.getByRole('link', { name: /Collection Queue|Xero reconciliation/ })).toHaveCount(0);
  await expect(overview.getByRole('link', { name: /Nom B/i })).toHaveCount(0);
  await expect(overview.getByRole('button', { name: /Nom B/i })).toHaveCount(0);

  await overview.getByRole('button', { name: 'Check my work', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Checking work…', exact: true })).toBeDisabled();
  expect(await requestAt(page, 0)).toMatchObject({ name: 'workCommitmentsList', body: {}, options: { force: true } });
  await resolve(page, 0, {
    commitments: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
    counts: { overdue: 2, needs_action: 1 },
    generatedAt: '2026-10-01T01:00:00Z',
    sourcesAtLimit: ['Projects & Tasks'],
  });
  await expect(overview.getByText(/Your loaded work: 2 overdue · 1 needing action · 3 total/)).toBeVisible();
  await expect(overview.getByText(/Partial: open My Commitments for source limitations/)).toBeVisible();

  await overview.getByRole('button', { name: 'Check my work', exact: true }).click();
  await resolve(page, 1, { error: 'Synthetic personal work request failed.' });
  await expect(overview.getByRole('alert')).toHaveText(/Synthetic personal work request failed\. Last checked personal counts are retained\./);
  await expect(overview.getByText(/Your loaded work: 2 overdue · 1 needing action · 3 total/)).toBeVisible();
  await page.screenshot({ path: 'test-results/management-overview-desktop.png', fullPage: true });
});
