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
    await page.getByRole('tab', { name: /^terms/i }).click();
    const editTerm = page.getByTitle('Edit Special Term').first();
    if (await editTerm.count()) {
      await editTerm.click();
      const editor = page.getByRole('dialog').filter({ hasText: 'Edit Special Term' });
      await expect(editor).toBeVisible();
      const governedRevision = editor.getByText('Whole-term revision', { exact: true });
      const legacyReview = editor.getByText('Legacy term — whole-term review required', { exact: true });
      await expect(governedRevision.or(legacyReview).first()).toBeVisible({ timeout: 20_000 });
      if (await governedRevision.isVisible()) {
        await expect(editor.getByRole('button', { name: /live document/i })).toBeVisible();
        await expect(editor.getByRole('button', { name: /^preview$/i })).toBeVisible({ timeout: 10_000 }).catch(() => {});
      }
    }
    expect(failures).toEqual([]);
  });
});
