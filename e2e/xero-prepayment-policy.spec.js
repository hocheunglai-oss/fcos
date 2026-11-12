import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-prepayment-policy.html';
const calls = (page) => page.evaluate(() => window.policyFixture.calls);

test('loads only when expanded and preserves unrelated drafts after an exact save', async ({ page }) => {
  await page.goto(fixture);
  const disclosure = page.getByText('Prepayment posting policies', { exact: true });
  await expect(disclosure).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await disclosure.click();
  const sell = page.getByRole('group', { name: 'Sell HKD' });
  const buy = page.getByRole('group', { name: 'Buy USD' });
  await sell.getByRole('checkbox', { name: 'Enabled' }).check();
  await sell.getByLabel('Deposit posting account').selectOption({ label: 'DEP · Fixture deposit account' });
  await sell.getByLabel('Zero-tax type').selectOption('NONE');
  await sell.getByLabel('Finance review reason').fill('Reviewed the HKD deposit account');
  await buy.getByLabel('Finance review reason').fill('Keep this other draft');
  await sell.getByRole('button', { name: 'Save reviewed policy' }).click();
  await expect(sell.getByText('Revision 1')).toBeVisible();
  await expect(buy.getByLabel('Finance review reason')).toHaveValue('Keep this other draft');
  await disclosure.click();
  await disclosure.click();
  expect((await calls(page)).map((call) => call.name)).toEqual(['xeroPrepaymentPolicyGet', 'xeroPrepaymentPolicySave']);
  expect((await calls(page))[1].body).toMatchObject({ direction: 'Sell', currency: 'HKD', expectedRevision: 0, enabled: true, accountCode: 'DEP', taxType: 'NONE' });
});

test('requires a fresh read after a lost acknowledgement and preserves one original save', async ({ page }) => {
  await page.goto(`${fixture}?lost`);
  await page.getByText('Prepayment posting policies', { exact: true }).click();
  const row = page.getByRole('group', { name: 'Buy USD' });
  await row.getByLabel('Finance review reason').fill('Keep this policy disabled');
  const save = row.getByRole('button', { name: 'Save reviewed policy' });
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Refresh policies before saving again');
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh policies' }).click();
  await expect(row.getByText('Revision 1')).toBeVisible();
  expect((await calls(page)).map((call) => call.name)).toEqual(['xeroPrepaymentPolicyGet', 'xeroPrepaymentPolicySave', 'xeroPrepaymentPolicyGet']);
});
