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

    const mobile = testInfo.project.name.includes('mobile');
    const secondary = mobile
      ? page.getByText('Month estimate & forward structure', { exact: true }).first()
      : page.getByText('Month estimates & forward structure', { exact: true });
    await secondary.click();
    const missingCurve = mobile
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

  test('keeps delivery and pricing month coverage separate and filterable', async ({ page }) => {
    await page.goto('/e2e/fixtures/markets-overview.html');
    const book = page.getByRole('region', { name: 'Your accessible book' });

    await book.getByRole('tab', { name: 'Delivery months' }).click();
    const delivery = book.getByRole('tabpanel', { name: 'Delivery months' });
    await expect(delivery).toContainText('Sept 2026');
    await expect(delivery).toContainText('Oct 2026');
    await delivery.getByRole('button', { name: 'Show all 6' }).click();
    await expect(delivery.getByRole('row')).toHaveCount(7);
    await expect(delivery).toContainText('Unallocated month');
    await delivery.getByLabel('Product').selectOption('S380');
    await delivery.getByRole('combobox').nth(2).selectOption('2026-10');
    await expect(delivery.getByRole('row').filter({ hasText: 'Atlas Shipping' })).toContainText('300 MT');
    await expect(delivery.getByRole('row').filter({ hasText: 'Delta Fleet' })).toContainText('500 MT');
    await expect(delivery.getByRole('row').filter({ hasText: 'Blue Ocean' })).toHaveCount(0);
    await delivery.getByRole('button', { name: 'Clear filters' }).click();
    await expect(delivery.getByLabel('Product')).toHaveValue('__all__');

    await book.getByRole('tab', { name: 'Pricing months' }).click();
    const pricing = book.getByRole('tabpanel', { name: 'Pricing months' });
    await expect(pricing).toContainText('Uncovered and excess hedge quantities reflect the direction of the physical position.');
    await pricing.getByLabel('Counterparty').selectOption('Atlas Shipping');
    const atlasRows = pricing.getByRole('row').filter({ hasText: 'Atlas Shipping' });
    await expect(atlasRows).toHaveCount(2);
    await expect(atlasRows.nth(0)).toContainText('Sept 2026');
    await expect(atlasRows.nth(0)).toContainText('Whole-month average');
    await expect(atlasRows.nth(0).getByLabel(/Positive 20 MT; uncovered/)).toBeVisible();
    await expect(atlasRows.nth(1)).toContainText('Oct 2026');
    await expect(atlasRows.nth(1).getByLabel(/Negative 50 MT; excess hedge/)).toBeVisible();
    await atlasRows.nth(0).getByText('Fixed physical quantities').click();
    await expect(atlasRows.nth(0)).toContainText('Sell fixed100 MT');
    await pricing.getByRole('button', { name: 'Clear filters' }).click();
    const unknownRow = pricing.getByRole('row').filter({ hasText: 'Blue Ocean' });
    await expect(unknownRow).toContainText('Balance starts 12 Sept 2026');
    await expect(unknownRow.getByLabel('Residual unavailable')).toBeVisible();
    await expect(unknownRow).toContainText('1 allocation input unavailable');
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
