import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-credit-allocation-actions.html';
const calls = page => page.evaluate(() => window.creditAllocationFixture.calls);

async function preview(page, query = '') {
  await page.goto(fixture + query);
  await page.getByText('Allocate a full credit', { exact: true }).click();
  expect(await calls(page)).toEqual([]);
  await page.getByLabel('Credit type').selectOption('Supplier_Invoice__c');
  await page.getByLabel('Salesforce credit number').fill('CN-0100');
  await page.getByRole('button', { name: 'Review credit' }).click();
  await expect(page.getByRole('region', { name: 'Credit allocation review' })).toContainText('INV-0100');
}

test('requires exact approval and recovers the same operation after reload', async ({ page }) => {
  await preview(page);
  const apply = page.getByRole('button', { name: 'Apply reviewed credit' });
  await expect(apply).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I approve this exact credit allocation' }).check();
  await apply.click();
  await expect(page.getByRole('alert')).toContainText('response was lost');
  await expect(apply).toHaveCount(0);
  const [review, original] = await calls(page);
  expect(review.name).toBe('xeroCreditAllocationPreview');
  expect(original.name).toBe('xeroCreditAllocationApply');
  await page.reload();
  await page.getByText('Allocate a full credit', { exact: true }).click();
  await expect(page.getByLabel('Salesforce credit number')).toBeDisabled();
  await page.getByRole('button', { name: 'Verify original allocation' }).click();
  await expect(page.getByText('Xero credit allocation verified.')).toBeVisible();
  expect(await calls(page)).toEqual([{ name: 'xeroCreditAllocationReconcile', body: {
    tenantId: original.body.tenantId, operationId: original.body.operationId,
    reviewFingerprint: original.body.reviewFingerprint, reviewed: true,
  } }]);
});

test('changing the credit clears review and posting-disabled preview has no apply action', async ({ page }) => {
  await preview(page, '?locked');
  await expect(page.getByText('New Xero credit allocations are disabled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply reviewed credit' })).toHaveCount(0);
  await page.getByLabel('Salesforce credit number').fill('CN-0200');
  await expect(page.getByRole('region', { name: 'Credit allocation review' })).toHaveCount(0);
  expect((await calls(page)).map(call => call.name)).toEqual(['xeroCreditAllocationPreview']);
});

test('finds the original durable operation from a fresh tab without repeating apply', async ({ page, context }) => {
  await preview(page);
  await page.getByRole('checkbox', { name: 'I approve this exact credit allocation' }).check();
  await page.getByRole('button', { name: 'Apply reviewed credit' }).click();
  await expect(page.getByRole('alert')).toContainText('response was lost');
  const [, original] = await calls(page);
  await page.close();

  const fresh = await context.newPage();
  await fresh.goto(fixture);
  await fresh.getByText('Allocate a full credit', { exact: true }).click();
  await expect(fresh.getByRole('button', { name: 'Verify original allocation' })).toHaveCount(0);
  await fresh.getByRole('button', { name: 'Find pending allocations' }).click();
  await fresh.getByRole('button', { name: 'Verify CN-0100' }).click();
  await expect(fresh.getByText('Xero credit allocation verified.')).toBeVisible();
  await expect(fresh.getByText('No pending allocations.')).toBeVisible();
  expect(await calls(fresh)).toEqual([
    { name: 'xeroCreditAllocationRecoveryQueue', body: { tenantId: original.body.tenantId } },
    { name: 'xeroCreditAllocationReconcile', body: { tenantId: original.body.tenantId,
      operationId: original.body.operationId, reviewFingerprint: original.body.reviewFingerprint, reviewed: true } },
  ]);
});
