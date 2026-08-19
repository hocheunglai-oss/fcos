import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);

test.describe('Fast verified payment reminders', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable test credentials.');
  test.use({ storageState: authState });

  test('opens one compact review and stops before delivery', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/payment-collections?tab=collections');
    await expect(page.getByText('Payment Collections', { exact: true }).first()).toBeVisible();

    const reminderButton = page.getByRole('button', { name: /send payment reminder for/i }).first();
    if (await reminderButton.count()) {
      await reminderButton.click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'External payment reminder' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Recipients', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Email preview', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /edit recipients/i })).toBeVisible();
      const sendButton = dialog.getByRole('button', { name: /send \d+ invoice/i });
      await expect(sendButton).toBeVisible();
      expect(await sendButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      })).toBe(true);
      await expect(dialog.getByRole('button', { name: /next|back/i })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toHaveCount(0);
    }

    expect(failures).toEqual([]);
  });
});
