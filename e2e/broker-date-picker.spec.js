import { expect, test } from '@playwright/test';

test.describe('Broker native date inputs', () => {
  test('keep both filter values in ISO format and expose keyboard clearing', async ({ page }) => {
    await page.goto('/e2e/fixtures/broker-date-picker.html');
    const from = page.locator('input[aria-label="From date"]');
    const to = page.locator('input[aria-label="To date"]');
    const output = page.getByLabel('Selected ISO date range');

    await expect(from).toHaveAttribute('type', 'date');
    await expect(to).toHaveAttribute('type', 'date');
    await expect(from).toHaveValue('2026-09-01');
    await expect(to).toHaveValue('2026-09-30');

    await from.fill('2026-09-05');
    await to.fill('2026-10-12');
    await expect(output).toHaveText('2026-09-05 | 2026-10-12');

    const clearFrom = page.getByRole('button', { name: 'Clear From date' });
    await clearFrom.focus();
    await page.keyboard.press('Enter');
    await expect(from).toHaveValue('');
    await expect(output).toHaveText('empty | 2026-10-12');

    const clearTo = page.getByRole('button', { name: 'Clear To date' });
    await clearTo.focus();
    await page.keyboard.press('Space');
    await expect(to).toHaveValue('');
    await expect(output).toHaveText('empty | empty');
  });
});
