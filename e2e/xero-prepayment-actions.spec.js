import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-prepayment-actions.html';
const calls = (page) => page.evaluate(() => window.prepaymentFixture.calls);
async function load(page, query = '') {
  await page.goto(fixture + query);
  await page.getByText('Trade cash and prepayments', { exact: true }).click();
  expect(await calls(page)).toEqual([]);
  await page.getByLabel('STEM reference').fill('HK2600100T');
  await page.getByRole('button', { name: 'Load prepayments' }).click();
}

test('requires an exact review and recovers the original operation after a lost response', async ({ page }) => {
  await load(page, '?lost');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Load exact review' }).click();
  const submit = page.getByRole('button', { name: 'Submit reviewed operation' });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Exact prepayment review' })).toContainText('HKD');
  await page.getByRole('checkbox', { name: 'I approve this exact Xero operation' }).check();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('response was lost');
  await expect(submit).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify original operation' }).click();
  await expect(page.getByText('Xero operation verified.')).toBeVisible();
  const requests = await calls(page);
  expect(requests.map((request) => request.name)).toEqual([
    'xeroPrepaymentQueue', 'xeroPrepaymentContacts', 'xeroPrepaymentPreview', 'xeroPrepaymentApply', 'xeroPrepaymentReconcile',
  ]);
  expect(requests[4].body).toMatchObject({ operationId: requests[3].body.operationId, reviewFingerprint: requests[3].body.reviewFingerprint });
});

test('allows receipt recovery while posting is disabled', async ({ page }) => {
  await load(page, '?locked');
  await expect(page.getByText(/New Xero posting is disabled/)).toBeVisible();
  await page.getByRole('button', { name: 'Verify receipt' }).click();
  await expect(page.getByText('Xero operation verified.')).toBeVisible();
  expect((await calls(page)).map((request) => request.name)).toEqual(['xeroPrepaymentQueue', 'xeroPrepaymentReconcile']);
});
