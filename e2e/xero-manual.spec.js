import { expect, test } from '@playwright/test';

test('manual loads both languages on demand and recovers from a failed fetch', async ({ page }) => {
  let requests = 0;
  await page.route('**/xero-portal-manual.json', async (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.continue();
  });
  await page.goto('/e2e/fixtures/xero-manual.html');
  await expect(page.getByRole('alert')).toContainText('The guide could not be loaded.');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xero Portal User Guide' })).toBeVisible();
  await page.getByRole('button', { name: '繁體中文', exact: true }).click();
  await expect(page.locator('#xero-manual-title')).not.toContainText('Xero Portal User Guide');
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
  expect(requests).toBe(2);
});
