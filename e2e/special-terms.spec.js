import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';

test.describe('Special Terms whole-term revision workspace', () => {
  test.skip(!authState || !existsSync(authState), 'Set FCOS_E2E_STORAGE_STATE to a signed-in test-user storage state.');
  test.use({ storageState: authState });

  test('shows governed clause-bank and migration queue surfaces without browser errors', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/special-terms');
    await expect(page.getByText('Special Terms', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /clause bank/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /migration queue/i })).toBeVisible();
    await page.getByRole('button', { name: /migration queue/i }).click();
    await expect(page.getByText('Controlled migration batches')).toBeVisible();
    expect(failures).toEqual([]);
  });
});
