import { expect, test } from '@playwright/test';

test('protected financial differences stay in attention while explicit link approval targets only that row', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  const row = page.getByRole('row').filter({ hasText: 'INV-EXCEPTION-1' });
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(row.getByRole('checkbox')).toBeEnabled();
  await row.locator('summary').click();
  await expect(row).toContainText('Salesforce account ID: 001BUYER0000001');
  await expect(row).toContainText('STEM reference');
  await expect(row).toContainText('Two Salesforce accounts share this Xero contact');
  await expect(row).toContainText('Shared Buyer · CL-B · 001BUYER0000002');
  await expect(row).toContainText('XERO-77 · xero-invoice-one');
  await expect(row).toContainText('Salesforce STEM-ONE → Xero OLD-REF');
  await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true });
  await row.getByRole('button', { name: 'Review / resolve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Xero accounting history remains unchanged/)).toBeVisible();
  await expect(dialog).toContainText('Shared Buyer · CL-B · 001BUYER0000002');
  await expect(dialog).toContainText('Two Salesforce accounts share this Xero contact');
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
  const retainedDifference = dialog.getByText(/Salesforce STEM-ONE → Xero OLD-REF/);
  await retainedDifference.scrollIntoViewIfNeeded();
  await expect(retainedDifference).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve link only' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('review-differences.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Approve link only' }).click();
  const writes = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'));
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ reviewed: true, selectedItemIds: ['review-one'] });
  await expect(page.getByRole('row').filter({ hasText: 'INV-EXCEPTION-1' })).toBeVisible();
  await page.getByRole('button', { name: /Matched/ }).click();
  const accepted = page.getByRole('row').filter({ hasText: 'INV-ACCEPTED-1' });
  await expect(accepted).toContainText('Accepted legacy');
  await accepted.locator('summary').click();
  await expect(accepted).toContainText('Salesforce STEM-ONE → Xero OLD-REF');
});

test('protected link requires manual selection and keeps the batch action link only', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  const row = page.getByRole('row').filter({ hasText: 'INV-EXCEPTION-1' });
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Check everything' }).click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Select eligible' }).click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review and sync selected' })).toBeDisabled();
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review selected links' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve link only' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve link only' }).click();
  const writes = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'));
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ reviewed: true, selectedItemIds: ['review-one'] });
});

for (const status of ['authorised', 'partial', 'failed']) {
  test(`${status} run resumes its persisted scope without another review selection`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/xero-exception.html?run=${status}`);
    const protectedRow = page.getByRole('row').filter({ hasText: 'INV-EXCEPTION-1' });
    await expect(protectedRow.getByRole('checkbox')).toBeChecked();
    await expect(protectedRow.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Select eligible' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Resume approved sync' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('saved selection');
    await expect(dialog).toContainText('Protected legacy · link only: 1');
    await expect(dialog).toContainText('Safe update: 1');
    await expect(dialog).toContainText('Create draft: 1');
    await expect(dialog).toContainText('INV-EXCEPTION-1');
    await expect(dialog).toContainText('INV-UPDATE');
    await expect(dialog).toContainText('INV-DRAFT');
    await expect(dialog).not.toContainText('INV-LINK');
    await dialog.getByRole('button', { name: 'Resume approved sync' }).click();
    const writes = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'));
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ runId: 'local-review-fixture', revision: 1 });
    expect(writes[0].body).not.toHaveProperty('reviewed');
    expect(writes[0].body).not.toHaveProperty('selectedItemIds');
  });
}

test('hard blocker offers evidence and recheck but no approval override', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  const row = page.getByRole('row').filter({ hasText: 'INV-HARD' });
  await expect(row.getByRole('checkbox')).toBeDisabled();
  await row.getByRole('button', { name: 'Review / resolve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ambiguous_legacy_match');
  await expect(dialog).toContainText('XERO-1 · candidate-one');
  await expect(dialog).toContainText('XERO-2 · candidate-two');
  await expect(dialog).toContainText('Financial safeguards cannot be overridden');
  await expect(dialog.getByRole('button', { name: 'Confirm and sync' })).toBeDisabled();
  expect(await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'))).toEqual([]);
});

test('approved mapping returns to the same document and approves only its refreshed row', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  await page.getByRole('row').filter({ hasText: 'INV-MAPPING' }).getByRole('button', { name: 'Review / resolve' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirm and sync' })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Fix mapping' }).click();
  const mappingDialog = page.getByRole('dialog');
  await mappingDialog.locator('select').first().selectOption('41000');
  await mappingDialog.getByRole('button', { name: 'Approve mapping' }).click();
  const reviewDialog = page.getByRole('dialog');
  await expect(reviewDialog).toContainText('INV-MAPPING');
  await expect(reviewDialog.getByRole('button', { name: 'Approve and update' })).toBeEnabled();
  await reviewDialog.getByRole('button', { name: 'Approve and update' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('approve-update.png'), animations: 'disabled' });
  await reviewDialog.getByRole('button', { name: 'Approve and update' }).click();
  const writes = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'));
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ reviewed: true, runId: 'local-review-refreshed', selectedItemIds: ['mapping-refreshed'] });
});

test('single review labels match the action and ignore unrelated preselected documents', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  await page.getByRole('button', { name: /Ready to sync/ }).click();
  await page.getByRole('row').filter({ hasText: 'INV-DRAFT' }).getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Approve and create draft' })).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('row').filter({ hasText: 'INV-UPDATE' }).getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Approve and update' })).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('row').filter({ hasText: 'INV-LINK' }).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve link only' }).click();
  const writes = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'));
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ reviewed: true, selectedItemIds: ['ready-link'] });
});

test('posting-mode change clears old selection and requires a fresh mode-matched preview', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html');
  await expect(page.getByText('Saved preview mode: Create drafts')).toBeVisible();
  await page.getByRole('button', { name: /Ready to sync/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'INV-DRAFT' });
  await expect(row.getByRole('checkbox')).toBeChecked();
  await page.getByLabel('Xero document posting').selectOption('authorised');
  await expect(page.getByText('Posting mode changed. Recheck before selecting or running documents.')).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review and sync selected' })).toBeDisabled();
  expect(await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'))).toEqual([]);
  await page.getByRole('button', { name: 'Check everything' }).click();
  const previews = await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncPreview'));
  expect(previews.at(-1).body.postingMode).toBe('authorised');
  await expect(page.getByText('Saved preview mode: Authorise verified documents')).toBeVisible();
  await expect(row.getByRole('checkbox')).not.toBeDisabled();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
});

test('single-document approval follows the financial gate', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html?gate=off');
  await page.getByRole('button', { name: /Ready to sync/ }).click();
  await page.getByRole('row').filter({ hasText: 'INV-UPDATE' }).getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Financial sync is disabled');
  await expect(dialog.getByRole('button', { name: 'Approve and update' })).toBeDisabled();
  expect(await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'))).toEqual([]);
});

test('protected link approval follows the financial gate', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html?gate=off');
  const row = page.getByRole('row').filter({ hasText: 'INV-EXCEPTION-1' });
  await row.getByRole('button', { name: 'Review / resolve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve link only' })).toBeDisabled();
  expect(await page.evaluate(() => window.exceptionFixture.requests.filter((request) => request.name === 'xeroFinancialSyncRun'))).toEqual([]);
});

test('Reason and resolution action stay within the viewport on both 100-row pages', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/e2e/fixtures/xero-exception.html?rows=205');
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Finance batch review' }) });
  const assertRow = async (documentNumber) => {
    const row = section.getByRole('row').filter({ hasText: documentNumber });
    await expect(row).toContainText('Finance-approved Xero account mapping is missing');
    const action = row.getByRole('button', { name: 'Review / resolve' });
    await expect(action).toBeVisible();
    const bounds = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    await action.click();
    await expect(page.getByRole('dialog')).toContainText('Finance-approved Xero account mapping is missing');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  };
  await assertRow('INV-BATCH-001');
  await section.getByRole('button', { name: 'Next', exact: true }).click();
  await assertRow('INV-BATCH-150');
  await page.screenshot({ path: testInfo.outputPath('reason-page-two.png'), animations: 'disabled' });
});

test('automatic petroleum mapping preview refreshes the saved mapping display', async ({ page }) => {
  await page.goto('/e2e/fixtures/xero-exception.html?automatic=1');
  await expect(page.getByText('0 saved mappings')).toBeVisible();
  await page.getByRole('button', { name: 'Check everything' }).click();
  await expect(page.getByText('1 saved mappings')).toBeVisible();
  const requests = await page.evaluate(() => window.exceptionFixture.requests.map((request) => request.name));
  expect(requests.filter((name) => name === 'xeroFinancialMappingsGet')).toHaveLength(2);
  await page.getByText('Advanced mapping setup').click();
  await expect(page.getByText('Each full check auto-approves Xero mappings for Salesforce petroleum products: buyer 41100, supplier 51100, tax NONE.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Xero product mappings' }).getByRole('row').filter({ hasText: 'HSFO 380' }).first()).toContainText('41100');
});
