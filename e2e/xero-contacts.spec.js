import { expect, test } from '@playwright/test';

async function assertInsideViewport(locator, page) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
}

test('Contacts shows Reason and long messages within the workspace for all actions and filtered actions', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.startsWith('mobile');
  await page.setViewportSize(isMobile
    ? { width: 390, height: 844 }
    : { width: 1600, height: 900 });
  await page.goto('/e2e/fixtures/xero-contacts.html');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();

  const section = page.locator('.xero-contacts-review');
  const wide = section.locator('.xero-contacts-review__wide');
  const compact = section.locator('.xero-contacts-review__compact');
  await expect(isMobile ? compact : wide).toBeVisible();
  await expect(isMobile ? wide : compact).toBeHidden();
  const row = isMobile
    ? compact.getByRole('article', { name: /PacificMarineFuelTrading/ })
    : wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' });
  await expect(isMobile ? row.getByText('Reason', { exact: true }) : wide.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
  await expect(row).toContainText('The contact is protected because');
  await expect(row).toContainText('Invoices and bills: 12');
  await assertInsideViewport(row, page);
  await assertInsideViewport(row.getByText('The contact is protected because', { exact: false }), page);
  await page.screenshot({ path: testInfo.outputPath(isMobile ? 'contacts-mobile.png' : 'contacts-wide.png'), fullPage: true });

  const actionFilter = section.locator('select').first();
  await expect(actionFilter).toHaveValue('all');
  await expect(isMobile ? compact.getByRole('article') : wide.getByRole('row')).toHaveCount(isMobile ? 5 : 6);
  await actionFilter.selectOption('exception');
  await expect(isMobile ? compact.getByRole('article') : wide.getByRole('row')).toHaveCount(isMobile ? 1 : 2);
  const exception = isMobile
    ? compact.getByRole('article', { name: /Shared Marine Buyer/ })
    : wide.getByRole('row').filter({ hasText: 'Shared Marine Buyer' });
  await expect(exception).toContainText('Xero contact is protected by an ambiguous Salesforce match');
  await expect(exception).toContainText('Two Salesforce accounts match this contact');
  await assertInsideViewport(exception, page);
  await actionFilter.selectOption('all');

  const rename = isMobile
    ? compact.getByRole('article', { name: /PacificMarineFuelTrading/ })
    : wide.getByRole('row').filter({ hasText: 'PacificMarineFuelTrading' });
  const checkbox = rename.getByRole('checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await section.getByRole('button', { name: 'Select visible eligible' }).click();
  await expect(checkbox).toBeChecked();
  if (!isMobile) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(compact).toBeVisible();
    const narrowRow = compact.getByRole('article', { name: /PacificMarineFuelTrading/ });
    await expect(narrowRow.getByRole('checkbox')).toBeChecked();
    await expect(narrowRow).toContainText('The contact is protected because');
    await assertInsideViewport(narrowRow, page);
    await page.screenshot({ path: testInfo.outputPath('contacts-narrow.png'), fullPage: true });
  }
  expect(await page.evaluate(() => window.contactsFixture.requests.filter(({ name }) => name.includes('Apply')))).toEqual([]);
});

test('Contacts table cells fit without overlap just above the wide-view threshold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Threshold layout is verified in the desktop project.');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/e2e/fixtures/xero-contacts.html');
  await page.getByRole('tab', { name: 'Contacts', exact: true }).click();
  const section = page.locator('.xero-contacts-review');
  const containerWidth = () => section.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  const initialWidth = await containerWidth();
  await page.setViewportSize({ width: 1600 + Math.round(1104 - initialWidth), height: 900 });
  const actualWidth = await containerWidth();
  expect(actualWidth).toBeGreaterThanOrEqual(1100);
  expect(actualWidth).toBeLessThanOrEqual(1110);

  const wide = section.locator('.xero-contacts-review__wide');
  await expect(wide).toBeVisible();
  await expect(wide.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
  const measured = await wide.locator('table').evaluate((table) => {
    const frame = table.parentElement;
    const cells = [...table.querySelectorAll('th, td')];
    return {
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      cellOverflow: cells.map((cell) => ({ text: cell.textContent.trim().slice(0, 45), excess: cell.scrollWidth - cell.clientWidth }))
        .filter((cell) => cell.excess > 1),
      badgeOverflow: [...table.querySelectorAll('tbody td > div.rounded-full')].map((badge) => {
        const cellRect = badge.parentElement.getBoundingClientRect();
        const badgeRect = badge.getBoundingClientRect();
        return { text: badge.textContent.trim(), excess: badgeRect.right - cellRect.right };
      }).filter((badge) => badge.excess > 1),
    };
  });
  expect(measured.frameOverflow).toBeLessThanOrEqual(1);
  expect(measured.cellOverflow).toEqual([]);
  expect(measured.badgeOverflow).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('contacts-threshold.png'), fullPage: true });
});
