import { expect, test } from '@playwright/test';
const path = '/e2e/fixtures/xero-integrity.html';
const requests = (page) => page.evaluate(() => window.xeroIntegrityFixture.requests);
test.beforeEach(async ({ page, baseURL }) => {
  page.fixtureErrors = []; page.providerRequests = [];
  page.on('pageerror', (error) => page.fixtureErrors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin || url.pathname.startsWith('/api/')) { page.providerRequests.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => {
  expect(page.fixtureErrors).toEqual([]); expect(page.providerRequests).toEqual([]);
  expect((await requests(page)).every((request) => request.name === 'xeroIntegrityReport')).toBe(true);
});

test('desktop portal shows saved integrity, separate currencies and read-only record details', async ({ page }) => {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Salesforce–Xero integrity' })).toBeVisible();
  await expect(page.getByLabel('From date')).toHaveValue('2026-01-01');
  await expect(page.getByText('INV-001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Payment evidence is unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByText(/full Salesforce source coverage is unknown/)).toBeVisible();
  await expect(page.getByRole('button', { name: /approve|sync now|apply|upload|connect xero|review selected/i })).toHaveCount(0);
  await expect(page.getByText('USD', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('HKD', { exact: true }).first()).toBeVisible();
  await page.getByRole('heading', { name: 'Correction history', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('codex-batch-001', { exact: true })).toBeVisible();
  await expect(page.getByText('codex-batch-002', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'outputs/xero-integrity-desktop.png', fullPage: true });
  const before = (await requests(page)).length;
  await page.getByRole('button', { name: 'Refresh evidence' }).click();
  await expect.poll(async () => (await requests(page)).length).toBeGreaterThan(before);
});

test('search, status, dates and pagination request evidence without starting operations', async ({ page }) => {
  await page.goto(path);
  await expect(page.getByText('INV-001', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await expect(page.getByText('INV-026', { exact: true })).toBeVisible();
  await page.getByLabel('Search records').fill('INV-003');
  await expect(page.getByText('INV-003', { exact: true })).toBeVisible();
  await expect(page.getByText('INV-026', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await requests(page)).at(-1)?.body.page).toBe(1);
  await page.getByLabel('Search records').fill('');
  await page.getByLabel('Status', { exact: true }).click();
  await page.getByRole('option', { name: 'Uncertain', exact: true }).click();
  await expect(page.getByText('Write outcome needs verified readback', { exact: true })).toBeVisible();
  await page.getByLabel('To date').fill('2026-09-01');
  await expect.poll(async () => (await requests(page)).at(-1)?.body.to).toBe('2026-09-01');
});

test('unchecked evidence shows unavailable rather than false zero or full reconciliation', async ({ page }) => {
  await page.goto(`${path}?case=empty`);
  await expect(page.getByRole('heading', { name: 'Salesforce–Xero integrity' })).toBeVisible();
  await expect(page.getByText('No saved comparison evidence.', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('100%', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/all records reconciled/i)).toHaveCount(0);
});

test('slow filter response cannot overwrite newer evidence and failures can retry', async ({ page }) => {
  await page.goto(`${path}?case=error`);
  await expect(page.getByText('Saved evidence is temporarily unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /retry/i }).click();
  await expect(page.getByText('INV-001', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Search records').fill('slow');
  await expect.poll(async () => (await requests(page)).some((request) => request.body.search === 'slow')).toBe(true);
  await page.getByLabel('Search records').fill('fast');
  await expect(page.getByText('FAST', { exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText('FAST', { exact: true })).toBeVisible();
  await expect(page.getByText('SLOW', { exact: true })).toHaveCount(0);
});
