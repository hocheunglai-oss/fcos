import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const manual = JSON.parse(await readFile(new URL('../src/content/xero-portal-manual.json', import.meta.url), 'utf8')).en;

test('manual stays English despite saved and supplied Chinese preference and recovers with English-only data', async ({ page }) => {
  let requests = 0;
  await page.addInitScript(() => window.localStorage.setItem('fcos:xero-portal-language:v1', 'zh-Hant'));
  await page.route('**/xero-portal-manual.json', async (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ en: manual }) });
  });
  await page.goto('/e2e/fixtures/xero-manual.html');
  await expect(page.getByRole('alert')).toContainText('The guide could not be loaded.');
  await expect(page.getByRole('alert')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xero Portal User Guide' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="xero-manual-title"]')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: /^(繁體中文|English)$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Clean up Xero contacts/ }).click();
  await expect(page.getByRole('heading', { name: 'Follow these steps', exact: true })).toBeVisible();
  await page.getByText('Button-by-button reference', { exact: false }).click();
  await expect(page.getByText('What it does', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('fcos:xero-portal-language:v1'))).toBe('zh-Hant');
  expect(requests).toBe(2);
});
