import { expect, test } from '@playwright/test';
const attempts = (page) => page.evaluate(() => window.dashboardRecovery.requests.filter((row) => row.name === 'dashboardAnalytics'));

test.describe('Dashboard failure recovery', () => {
  test.skip(process.env.FCOS_E2E_DASHBOARD_RECOVERY !== '1', 'Local fixture only; every provider call is stubbed.');
  test('failure settles once; Retry and Refresh are explicit, and filter changes load once', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/e2e/fixtures/dashboard-recovery.html');
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    // More than a full render/request cycle: the original loop rapidly increments this count.
    await page.waitForTimeout(500);
    expect(await attempts(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'Retry analytics' }).click();
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await attempts(page)).toHaveLength(2);
    expect((await attempts(page))[1].force).toBe(true);
    if (await page.getByRole('button', { name: /^Filters/ }).isVisible()) await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Period', { exact: true }).selectOption('last_month');
    await expect.poll(async () => (await attempts(page)).length).toBe(3);
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await attempts(page)).toHaveLength(3);
    await page.evaluate(() => { window.dashboardRecovery.mode = 'success'; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Recovered buyer', { exact: true })).toBeVisible();
    expect(await attempts(page)).toHaveLength(4);
    await expect(page.getByText('Analytics unavailable', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('an older aborted request cannot clear loading or overwrite the new result', async ({ page }) => {
    await page.goto('/e2e/fixtures/dashboard-recovery.html');
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.dashboardRecovery.mode = 'pending'; });
    await page.getByRole('button', { name: 'Retry analytics' }).click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(1);
    if (await page.getByRole('button', { name: /^Filters/ }).isVisible()) await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Period', { exact: true }).selectOption('last_month');
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(2);
    await page.evaluate(() => window.dashboardRecovery.pending[0].reject(new Error('Stale failure')));
    await expect(page.getByText('Loading analytics…', { exact: true })).toBeVisible();
    await expect(page.getByText('Stale failure', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.dashboardRecovery.pending[1].resolve({ data: { rankings: { accountsByNetPnl: [{ accountId: 'new', name: 'Latest buyer', netPnl: 1 }] } } }));
    await expect(page.getByText('Latest buyer', { exact: true })).toBeVisible();
    expect(await attempts(page)).toHaveLength(3);
  });
});
