import { expect, test } from '@playwright/test';

test.describe('variable charge review draft transitions', () => {
  test.skip(process.env.FCOS_E2E_VARIABLE_CHARGE_FIXTURE !== '1', 'Opt-in local fixture with all operations stubbed.');

  test('GM supplier approval keeps an edited cost after selecting Correct', async ({ page }) => {
    await page.goto('/e2e/fixtures/variable-charge-review.html');
    await page.getByRole('button', { name: 'Review Supplier Leg as GM' }).click();
    await page.getByLabel('Reason', { exact: true }).fill('Supplier invoice checked by GM');
    await page.getByRole('button', { name: 'Start Review', exact: true }).click();
    const supplier = page.getByRole('group', { name: 'BASIC CALLING COST supplier review' });
    await supplier.getByRole('button', { name: 'Edit Cost', exact: true }).click();
    await page.getByLabel('Supplier Fixed Cost (USD)', { exact: true }).fill('1888.25');
    await supplier.getByRole('button', { name: 'Correct', exact: true }).click();
    await expect(page.getByText('USD 1,888.25', { exact: true })).toBeVisible();
    await page.locator('#supplier-review-note-0012x0000000001AAA').fill('Supplier invoice reviewed');
    const approve = page.getByRole('button', { name: 'Approve Supplier Costs', exact: true });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect.poll(() => page.evaluate(() => window.variableChargeFixture.requests.length)).toBe(1);
    const payload = await page.evaluate(() => window.variableChargeFixture.requests[0]);
    expect(payload.sides).toEqual(['cost']);
    expect(payload.cost.rowOutcomes[0].outcome).toBe('changed');
    expect(payload.cost.extraCostUpdates[0]).toMatchObject({ supplierCost: 1888.25, inputCurrency: 'USD' });
    expect(payload.buyerCharge).toBeUndefined();
    expect(payload.gmOverrideReason).toBe('Supplier invoice checked by GM');
  });

  test('Correct and cancellation undo preserve independent buyer edits during GM review of both legs', async ({ page }) => {
    await page.goto('/e2e/fixtures/variable-charge-review.html');
    await page.getByRole('button', { name: 'Review Supplier Leg as GM' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Both legs', exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('Both invoices checked by GM');
    await page.getByRole('button', { name: 'Start Review', exact: true }).click();
    const supplier = page.getByRole('group', { name: 'BASIC CALLING COST supplier review' });
    const buyer = page.getByRole('group', { name: 'BASIC CALLING COST buyer review' });
    await buyer.getByRole('button', { name: 'Charge Buyer', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Buyer Price' }).click();
    await page.getByLabel('Buyer Fixed Charge (USD)', { exact: true }).fill('2300');
    await supplier.getByRole('button', { name: 'Edit Cost', exact: true }).click();
    await page.getByLabel('Supplier Fixed Cost (USD)', { exact: true }).fill('1900');
    await supplier.getByRole('button', { name: 'Correct', exact: true }).click();
    await expect(page.getByLabel('Buyer Fixed Charge (USD)', { exact: true })).toHaveValue('2300');
    await buyer.getByRole('button', { name: 'Do Not Charge', exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Extra Cost', exact: true }).click();
    await supplier.getByRole('button', { name: 'Correct', exact: true }).click();
    await expect(buyer.getByRole('button', { name: 'Do Not Charge', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('USD 1,900.00', { exact: true })).toBeVisible();
    await buyer.getByRole('button', { name: 'Charge Buyer', exact: true }).click();
    await expect(page.getByLabel('Buyer Fixed Charge (USD)', { exact: true })).toHaveValue('2300');
    await page.locator('#supplier-review-note-0012x0000000001AAA').fill('Supplier invoice checked');
    await page.locator('#buyer-review-note-0012x0000000001AAA').fill('Buyer invoice checked');
    await page.getByRole('button', { name: 'Approve Both', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.variableChargeFixture.requests.length)).toBe(1);
    const payload = await page.evaluate(() => window.variableChargeFixture.requests[0]);
    expect(payload.cost.rowOutcomes[0].outcome).toBe('changed');
    expect(payload.cost.extraCostUpdates[0].supplierCost).toBe(1900);
    expect(payload.cost.cancellations).toEqual([]);
    expect(payload.buyerCharge.extraCostUpdates[0].buyerPrice).toBe(2300);
  });
});
