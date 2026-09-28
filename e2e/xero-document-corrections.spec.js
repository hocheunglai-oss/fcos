import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-document-corrections.html';
const previewName = 'Preview date and reference corrections';
const requests = (page) => page.evaluate(() => window.documentCorrectionFixture.requests);

async function openPanel(page, scenario = '') {
  await page.goto(`${fixture}${scenario ? `?scenario=${scenario}` : ''}`);
  await page.getByRole('button', { name: previewName, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Date and reference corrections' })).toBeVisible();
  return dialog;
}

async function preview(page, scenario = '') {
  const dialog = await openPanel(page, scenario);
  await dialog.getByRole('button', { name: previewName, exact: true }).click();
  await expect(dialog.getByRole('row').filter({ hasText: 'INV-ONE' })).toBeVisible();
  return dialog;
}

test.describe('offline document correction review', () => {
  test.skip(process.env.FCOS_E2E_DOCUMENT_CORRECTIONS_FIXTURE !== '1', 'Opt-in fixture; provider operations are stubbed.');

  test('opening the panel makes no correction call and pauses ordinary background scans', async ({ page }) => {
    await page.clock.install();
    const dialog = await openPanel(page);
    expect((await requests(page)).filter((request) => request.name.includes('Correction'))).toHaveLength(0);
    await page.clock.fastForward(180000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialSyncPreview')).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialSyncPreview')).toHaveLength(0);
    await page.getByRole('button', { name: 'Check everything', exact: true }).click();
    await expect.poll(async () => (await requests(page)).filter((request) => request.name === 'xeroFinancialSyncPreview').length).toBe(1);
  });

  test('eligible corrections are selected, reasons always show, differences expand and apply submits only the reviewed selection', async ({ page }) => {
    const dialog = await preview(page);
    const one = dialog.getByRole('row').filter({ hasText: 'INV-ONE' });
    const two = dialog.getByRole('row').filter({ hasText: 'INV-TWO' });
    await expect(one.getByRole('checkbox')).toBeChecked();
    await expect(one).toContainText('Reference differs');
    for (const number of ['INV-PAID-DATE', 'INV-LEGACY', 'INV-MATCHED']) {
      await expect(dialog.getByRole('row').filter({ hasText: number }).getByRole('checkbox')).toBeDisabled();
    }
    await expect(dialog).toContainText('paid documents remain eligible');
    await one.locator('summary').first().click();
    await expect(one).toContainText('Before: (empty)');
    await expect(one).toContainText('After: OFFLINE FIXTURE VESSEL / STEM-ONE');
    await one.getByText('Source evidence', { exact: true }).click();
    await expect(one).toContainText('Buyer delivery date: 2026-01-27');
    await expect(one).toContainText('Buyer invoice date: 2026-01-28');
    await expect(one).toContainText('STEM reference code: HK26STEM-ONE');
    const conflict = dialog.getByRole('row').filter({ hasText: 'INV-PAID-DATE' });
    await conflict.getByText('Source evidence', { exact: true }).click();
    await expect(conflict).toContainText('Linked buyer invoices');
    await expect(conflict).toContainText('INV-CONFLICTING-BUYER');
    await expect(conflict).toContainText('Buyer delivery date: 2026-01-29');
    await expect(conflict).toContainText('Buyer invoice date: 2026-01-30');
    await two.getByText('Source evidence', { exact: true }).click();
    await expect(two).toContainText('The only active normal buyer invoice on this STEM');
    await expect(two).toContainText('Source due date: 2026-02-28 (supplier invoice)');
    await expect(two).toContainText('Buyer invoices considered on this STEM');
    await expect(two).toContainText('INV-PROFORMA');
    await expect(two).toContainText('Proforma invoice');
    await two.getByRole('checkbox').uncheck();
    const action = dialog.getByRole('button', { name: 'Apply selected corrections', exact: true });
    await action.click();
    await expect(one).toContainText('Selected corrections confirmed');
    await expect(action).toBeDisabled();
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toEqual([
      { name: 'xeroFinancialDocumentCorrectionApply', body: { previewId: 'correction-preview-one', itemIds: ['one'] } },
    ]);
    expect((await requests(page)).filter((request) => ['xeroFinancialSyncRun', 'xeroFinancialPaymentApply'].includes(request.name))).toHaveLength(0);
  });

  test('financial gate permits preview and blocks Apply', async ({ page }) => {
    const dialog = await preview(page, 'locked');
    await expect(dialog).toContainText('Financial actions are locked');
    await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toHaveLength(0);
  });

  test('25-item batches disable further selections until a selected item is removed', async ({ page }) => {
    const dialog = await openPanel(page, 'batch');
    await dialog.getByRole('button', { name: previewName, exact: true }).click();
    await expect(dialog).toContainText('25 selected.');
    const last = dialog.getByRole('checkbox', { name: 'Select correction for INV-26', exact: true });
    await expect(last).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Select correction for INV-1', exact: true }).uncheck();
    await expect(last).toBeEnabled();
    await last.check();
    await dialog.getByRole('button', { name: 'Apply selected corrections', exact: true }).click();
    const apply = (await requests(page)).find((request) => request.name === 'xeroFinancialDocumentCorrectionApply');
    expect(apply.body.itemIds).toHaveLength(25);
    expect(apply.body.itemIds).not.toContain('1');
    expect(apply.body.itemIds).toContain('26');
  });

  test('lost and missing responses stay uncertain and source-change blockers stay visible without retries', async ({ page }) => {
    for (const scenario of ['lost', 'missing', 'blocked-result']) {
      const dialog = await preview(page, scenario);
      await dialog.getByRole('button', { name: 'Apply selected corrections', exact: true }).click();
      await expect(dialog.getByRole('row').filter({ hasText: 'INV-TWO' })).toContainText(scenario === 'blocked-result' ? 'Source changed after the preview.' : 'Uncertain');
      await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('row').filter({ hasText: 'INV-TWO' }).getByRole('checkbox')).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toHaveLength(1);
      await expect(dialog).toContainText('No automatic retry will occur.');
    }
  });

  test('active application locks close, preview and selections until the result is received', async ({ page }) => {
    const dialog = await preview(page, 'pending');
    await dialog.getByRole('button', { name: 'Apply selected corrections', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Applying corrections…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: previewName, exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.documentCorrectionFixture.finishApply());
    await expect(dialog).toContainText('Applied: 2');
  });

  test('uncertain results recover against original preview IDs through explicit readback even when financial writes are locked', async ({ page }) => {
    const dialog = await preview(page, 'missing');
    await dialog.getByRole('button', { name: 'Apply selected corrections', exact: true }).click();
    await expect(dialog.getByRole('row').filter({ hasText: 'INV-TWO' })).toContainText('Uncertain');
    await page.evaluate(() => window.documentCorrectionFixture.setFinancialEnabled(false));
    await expect(dialog).toContainText('Financial actions are locked');
    await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
    const verify = dialog.getByRole('button', { name: 'Verify uncertain results', exact: true });
    await expect(verify).toBeEnabled();
    await verify.click();
    await expect(dialog.getByRole('row').filter({ hasText: 'INV-TWO' })).toContainText('Recovered through exact readback');
    await expect(verify).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionVerify')).toEqual([
      { name: 'xeroFinancialDocumentCorrectionVerify', body: { previewId: 'correction-preview-one', itemIds: ['two'] } },
    ]);
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toHaveLength(1);
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionPreview')).toHaveLength(1);
  });

  test('desktop and mobile layouts show reasons and differences without page overflow or browser errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const dialog = await preview(page);
      await dialog.getByRole('row').filter({ hasText: 'INV-ONE' }).locator('summary').first().click();
      await expect(dialog.getByRole('row').filter({ hasText: 'INV-ONE' })).toContainText('After:');
      const dimensions = await page.evaluate(() => ({ width: innerWidth, pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
      expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.width + 1);
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(-1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width > 1000) expect(bounds.width).toBeGreaterThan(1000);
      await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('all saved preview pages load before selection and large inventories render 100 rows per review page', async ({ page }) => {
    const dialog = await openPanel(page, 'paged-pending');
    await dialog.getByRole('button', { name: previewName, exact: true }).click();
    await expect(dialog).toContainText('Loading correction preview: 100 of 101 records.');
    await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('row')).toHaveCount(0);
    await page.evaluate(() => window.documentCorrectionFixture.finishPage());
    await expect(dialog).toContainText('101 records loaded');
    await expect(dialog.getByRole('row')).toHaveCount(101);
    await expect(dialog).toContainText('25 selected.');
    await dialog.getByRole('button', { name: 'Next correction page', exact: true }).click();
    await expect(dialog.getByRole('row').filter({ hasText: 'INV-PAGE-101' })).toBeVisible();
    await expect(dialog.getByRole('row')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Show selected corrections', exact: true }).click();
    await expect(dialog.getByRole('row')).toHaveCount(26);
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionPage')).toEqual([
      { name: 'xeroFinancialDocumentCorrectionPage', body: { previewId: 'correction-preview-one', offset: 100 } },
    ]);
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toHaveLength(0);
  });

  test('an inconsistent saved preview page clears all partial evidence and never enables selection or apply', async ({ page }) => {
    const dialog = await openPanel(page, 'paged-invalid');
    await dialog.getByRole('button', { name: previewName, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Incomplete correction preview pages');
    await expect(dialog.getByRole('row')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Apply selected corrections', exact: true })).toBeDisabled();
    expect((await requests(page)).filter((request) => request.name === 'xeroFinancialDocumentCorrectionApply')).toHaveLength(0);
  });
});
