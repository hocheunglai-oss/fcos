import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-issued-preservation.html';
const calls = (page) => page.evaluate(() => window.issuedPreservationFixture.requests);

async function openPreview(page, scenario = '') {
  await page.goto(`${fixture}${scenario ? `?scenario=${scenario}` : ''}`);
  await page.getByRole('button', { name: 'Preserve verified bills', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Preserve verified bills', exact: true })).toBeVisible();
  const packet = await page.evaluate(() => window.issuedPreservationFixture.packet);
  await dialog.getByLabel('JSON evidence packet (1–25 records, maximum 200 KB)', { exact: true }).setInputFiles({
    name: 'issued-evidence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)),
  });
  await dialog.getByRole('button', { name: 'Verify records', exact: true }).click();
  await expect(dialog.getByRole('row').filter({ hasText: 'SUP-HOLD' })).toBeVisible();
  return dialog;
}

test.describe('offline issued supplier preservation', () => {
  test.skip(process.env.FCOS_E2E_ISSUED_PRESERVATION_FIXTURE !== '1', 'Opt-in local fixture; every provider operation is stubbed.');

  test('opening the lazy panel pauses background checks until an intentional ordinary check', async ({ page }) => {
    await page.clock.install();
    await page.goto(fixture);
    await page.getByRole('button', { name: 'Preserve verified bills', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Preserve verified bills', exact: true })).toBeVisible();
    await page.clock.fastForward(180000);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect((await calls(page)).filter((call) => call.name === 'xeroFinancialSyncPreview')).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).not.toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await calls(page)).filter((call) => call.name === 'xeroFinancialSyncPreview')).toHaveLength(0);
    await page.getByRole('button', { name: 'Check everything', exact: true }).click();
    await expect.poll(async () => (await calls(page)).filter((call) => call.name === 'xeroFinancialSyncPreview').length).toBe(1);
  });

  test('blocked records stay disabled and the dedicated link action forwards exactly selected verified IDs', async ({ page }) => {
    const dialog = await openPreview(page);
    const held = dialog.getByRole('row').filter({ hasText: 'SUP-HOLD' });
    await expect(held.getByRole('checkbox')).toBeDisabled();
    await expect(held).toContainText('Issued invoice amount differs');
    const action = dialog.getByRole('button', { name: 'Link and preserve Xero details', exact: true });
    await expect(action).toBeDisabled();
    await dialog.getByRole('row').filter({ hasText: 'SUP-ONE' }).getByRole('checkbox').check();
    await dialog.getByRole('row').filter({ hasText: 'SUP-TWO' }).getByRole('checkbox').check();
    await action.click();
    await expect(dialog.getByRole('row').filter({ hasText: 'SUP-ONE' })).toContainText('Link confirmed; Xero bill details preserved.');
    await expect(dialog.getByRole('row').filter({ hasText: 'SUP-TWO' })).toContainText('Link confirmed; Xero bill details preserved.');
    await expect(dialog).toContainText('Xero financial writes: 0');
    const expected = await page.evaluate(() => ({ runId: window.issuedPreservationFixture.runId, revision: 1,
      selectedItemIds: window.issuedPreservationFixture.rows.slice(0, 2).map((row) => row.id), reviewed: true }));
    const requests = await calls(page);
    expect(requests.filter((call) => call.name === 'xeroFinancialDocumentPreservationRun')).toEqual([
      { name: 'xeroFinancialDocumentPreservationRun', body: expected },
    ]);
    expect(requests.filter((call) => ['xeroFinancialSyncRun', 'xeroFinancialPaymentApply'].includes(call.name))).toHaveLength(0);
    await expect(action).toBeDisabled();
  });

  test('an unconfirmed response retains the attempt and selection while disabling retries', async ({ page }) => {
    const dialog = await openPreview(page, 'failure');
    const selected = dialog.getByRole('row').filter({ hasText: 'SUP-ONE' });
    await selected.getByRole('checkbox').check();
    const action = dialog.getByRole('button', { name: 'Link and preserve Xero details', exact: true });
    await action.click();
    await expect(dialog.getByRole('alert')).toContainText('No automatic retry will occur.');
    await expect(selected).toContainText('uncertain');
    await expect(selected.getByRole('checkbox')).toBeChecked();
    await expect(selected.getByRole('checkbox')).toBeDisabled();
    await expect(action).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Verify records', exact: true })).toBeDisabled();
    expect((await calls(page)).filter((call) => call.name === 'xeroFinancialDocumentPreservationRun')).toHaveLength(1);
    expect((await calls(page)).filter((call) => ['xeroFinancialSyncRun', 'xeroFinancialPaymentApply'].includes(call.name))).toHaveLength(0);
  });

  test('desktop and mobile layouts contain the preview without horizontal page overflow', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const dialog = await openPreview(page);
      const dimensions = await page.evaluate(() => ({ width: window.innerWidth,
        pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
      expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.width + 1);
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(-1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      await expect(dialog.getByRole('button', { name: 'Link and preserve Xero details', exact: true })).toBeVisible();
    }
  });
});
