import { expect, test } from '@playwright/test';

test.describe('Markets reading overview fixture', () => {
  test('keeps units, missing values, source status, evidence, and drill-downs clear', async ({ page }, testInfo) => {
    await page.goto('/e2e/fixtures/markets-overview.html');
    await expect(page.getByRole('heading', { name: 'Market price board' })).toBeVisible();
    await expect(page.getByText('One expected HSFO 380 close series is unavailable')).toBeVisible();
    await expect(page.getByText('Supply a corrected CSV containing PPXDK00 close values.')).toBeVisible();
    await expect(page.locator('.market-price-board__price:visible').filter({ hasText: '97.125 USD/BBL' }).first()).toBeVisible();
    await expect(page.locator('.market-price-board__price:visible').filter({ hasText: '752.00 USD/MT' }).first()).toBeVisible();
    await page.screenshot({ path: `outputs/markets-overview/${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });

    const secondary = testInfo.project.name === 'mobile'
      ? page.getByText('Month estimate & forward structure', { exact: true }).first()
      : page.getByText('Month estimates & forward structure', { exact: true });
    await secondary.click();
    const missingCurve = testInfo.project.name === 'mobile'
      ? page.locator('.market-price-board__card-secondary[open] .market-signed-value:visible').filter({ hasText: 'Not published' })
      : page.locator('.market-price-board__secondary[open] .market-signed-value:visible').filter({ hasText: 'Not published' });
    await expect(missingCurve).toBeVisible();

    await page.getByRole('button', { name: 'Show details for LSMGO latest MOPS' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('USD/BBL');
    await expect(dialog).toContainText('POABC00');
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Show details for LSMGO Singapore delivered price' }).click();
    await expect(dialog.getByText('Unit', { exact: true }).locator('..')).toContainText('USD/MT');
    const deliveredSource = dialog.getByText('Source code', { exact: true }).locator('..');
    await expect(deliveredSource).toContainText('Unavailable');
    await expect(deliveredSource).not.toContainText('POABC00');
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Show details for S0.5% published move' }).click();
    await expect(dialog).toContainText('Difference between current and previous published MOPS assessments');
    await expect(dialog.getByText('Source sample count', { exact: true }).locator('..')).toContainText('2');
    await expect(dialog).toContainText('16 Sept 2026 against 15 Sept 2026');
    await dialog.getByRole('button', { name: 'Close' }).click();

    const book = page.getByRole('region', { name: 'Your accessible book' });
    await expect(book.getByRole('row')).toHaveCount(6);
    await book.getByRole('button', { name: 'Show all 6' }).click();
    await expect(book.getByRole('row')).toHaveCount(7);
    await expect(book).toContainText('7,450 BBL');
    await expect(book).toContainText('Quantity difference');
    await expect(book).toContainText('50 MT excess hedge');
    const missingBookRow = book.getByRole('row').filter({ hasText: 'Far Horizon' });
    await expect(missingBookRow).toContainText('Unavailable');
    await expect(missingBookRow).toContainText('No cargo');
    await expect(missingBookRow.getByText('0%', { exact: true })).toHaveCount(0);

    await expect(page.locator('.market-what-matters__list > li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Open delivered prices' }).click();
    await expect(page.getByText('Selected market view:')).toContainText('delivered');
  });

  test('historical mode hides current book numbers', async ({ page }) => {
    await page.goto('/e2e/fixtures/markets-overview.html?state=historical');
    const book = page.getByRole('region', { name: 'Your accessible book' });
    await expect(book).toContainText('Current book quantities are hidden for this historical snapshot');
    await expect(book).not.toContainText('Atlas Shipping');
    await expect(book).not.toContainText('6 open physicals');
  });

  test('book loading and retry states stay local to book context', async ({ page }) => {
    await page.goto('/e2e/fixtures/markets-overview.html?state=loading');
    await expect(page.getByText('Loading accessible positions')).toBeVisible();
    await expect(page.locator('.market-price-board__price:visible').filter({ hasText: '97.125 USD/BBL' }).first()).toBeVisible();

    await page.goto('/e2e/fixtures/markets-overview.html?state=error');
    await expect(page.getByRole('alert')).toContainText('Fixture book read failed.');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('Atlas Shipping')).toBeVisible();
    await expect(page.locator('.market-price-board__price:visible').filter({ hasText: '97.125 USD/BBL' }).first()).toBeVisible();
  });
});
