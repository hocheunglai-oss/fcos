import { expect, test } from '@playwright/test';

const fixture = '/e2e/fixtures/xero-native-document-preview.html';

test('the verification environment renders the desktop panel without financial action controls or calls', async ({ page }) => {
  await page.goto(fixture + '?verification-only');
  const panel = page.getByRole('region', { name: 'Trading FX document review' });
  await expect(panel).toContainText('Draft actions are unavailable in this verification environment.');
  await expect(panel.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeDocumentFixture.calls)).toEqual([]);
});

async function requestReview(page, query = '') {
  await page.goto(fixture + query);
  await page.getByText('Review Trading FX document', { exact: true }).click();
  expect(await page.evaluate(() => window.nativeDocumentFixture.calls)).toEqual([]);
  await page.getByLabel('Document type').selectOption('Supplier_Invoice__c');
  await page.getByLabel('Salesforce document number').fill('BILL-0100');
  await page.getByRole('button', { name: 'Review document' }).click();
}

test('reviews one selected native document and shows four-place unit price with no apply action', async ({ page }) => {
  await requestReview(page);
  const review = page.getByRole('region', { name: 'Trading FX source review' });
  await expect(review).toContainText('HKD');
  await expect(review).toContainText('USD');
  await expect(review).toContainText('1.005');
  await expect(review).toContainText('7999');
  await expect(review.getByRole('region', { name: 'Xero document search' })).toContainText('Review the historical Xero bill.');
  await expect(page.getByRole('button', { name: /apply|post/i })).toHaveCount(0);
  await page.getByLabel('Salesforce document number').fill('BILL-0101');
  await expect(review).toHaveCount(0);
  expect((await page.evaluate(() => window.nativeDocumentFixture.calls)).map(call => call.name)).toEqual(['xeroFinancialSyncPreview']);
});

test('rejects a review for a different document', async ({ page }) => {
  await requestReview(page, '?wrong-document');
  await expect(page.getByRole('alert')).toContainText('does not match this document');
  await expect(page.getByRole('region', { name: 'Trading FX source review' })).toHaveCount(0);
});

test('submits the exact reviewed draft after explicit confirmation and shows the original receipt', async ({ page }) => {
  await requestReview(page, '?eligible');
  await expect(page.getByRole('region', { name: 'Trading FX source review' })).toContainText('Issued fuel');
  const submit = page.getByRole('button', { name: 'Create Xero draft' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I reviewed these Xero draft lines' }).click();
  await submit.click();
  await expect(page.getByRole('status')).toHaveText('Xero draft verified.');
  const calls = await page.evaluate(() => window.nativeDocumentFixture.calls);
  expect(calls.map(call => call.name)).toEqual(['xeroFinancialSyncPreview', 'xeroNativeDocumentApply']);
  expect(calls[1].body).toEqual({ tenantId: expect.any(String), sourceId: 'a06000000000001AAA',
    sourceObject: 'Supplier_Invoice__c', operationId: expect.any(String), reviewFingerprint: 'a'.repeat(64), reviewed: true });
});

test('recovers a lost submission response after reload with the original operation and no second apply', async ({ page }) => {
  await requestReview(page, '?lost');
  await page.getByRole('checkbox', { name: 'I reviewed these Xero draft lines' }).click();
  await page.getByRole('button', { name: 'Create Xero draft' }).click();
  await expect(page.getByRole('alert')).toHaveText('The response was lost.');
  const original = await page.evaluate(() => window.nativeDocumentFixture.calls.find(call => call.name === 'xeroNativeDocumentApply').body);
  await page.reload();
  await page.getByText('Review Trading FX document', { exact: true }).click();
  await page.getByRole('button', { name: 'Verify original draft for BILL-0100' }).click();
  await expect(page.getByRole('status')).toHaveText('Xero draft verified.');
  expect(await page.evaluate(() => window.nativeDocumentFixture.calls)).toEqual([{ name: 'xeroNativeDocumentReconcile', body: original }]);
});

test('finds a durable pending draft with empty browser storage', async ({ page }) => {
  await page.goto(fixture + '?queue');
  await page.getByText('Review Trading FX document', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review document' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify original draft for BILL-0100' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Find pending drafts' }).click();
  await page.getByRole('button', { name: 'Verify original draft for BILL-0100' }).click();
  await expect(page.getByRole('status')).toHaveText('Xero draft verified.');
  await expect(page.getByText('No pending drafts.')).toBeVisible();
  expect((await page.evaluate(() => window.nativeDocumentFixture.calls)).map(call => call.name))
    .toEqual(['xeroNativeDocumentRecoveryQueue', 'xeroNativeDocumentReconcile']);
});
