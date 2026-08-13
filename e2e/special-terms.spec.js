import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);

test.describe('Special Terms whole-term revision workspace', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable test credentials.');
  test.use({ storageState: authState });

  test('shows governed clause-bank and migration queue surfaces without browser errors', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/special-terms');
    await expect(page.getByText('Special Terms', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /clause bank/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /migration queue/i })).toBeVisible();
    await page.getByRole('tab', { name: /migration queue/i }).click();
    await expect(page.getByText('Controlled migration batches')).toBeVisible();
    expect(failures).toEqual([]);
  });
});
