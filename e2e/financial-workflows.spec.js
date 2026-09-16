import { expect, test } from '@playwright/test';
test.describe('simplified financial workflows', () => {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1', 'Local fixture only, with every provider operation stubbed.');
  for (const scenario of ['unstarted', 'missing-workflow']) {
    test(`Salesforce dispute without an FCOS case opens its agreement (${scenario})`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/e2e/fixtures/financial-workflows.html?scenario=${scenario}`);
      await expect(page.getByRole('row').filter({ hasText: 'TEST STEM' })).toContainText('Prepare');
      await page.getByRole('button', { name: 'Complete agreement', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('navigation', { name: 'Dispute progress' })).toContainText('PrepareApproveSettleClosed');
      expect(errors).toEqual([]);
      const writes = await page.evaluate(() => window.workflowFixture.requests.filter((row) => row.name.startsWith('disputeWorkflow') && row.name !== 'disputeWorkflowList'));
      expect(writes).toEqual([]);
    });
  }
  test('saved check, dependency waiting and one reviewed sync action', async ({ page }, testInfo) => {
    await page.goto('/e2e/fixtures/financial-workflows.html');
    await expect(page.getByText('TEST-INV-2', { exact: true })).toBeVisible();
    await expect(page.getByText('TEST-INV-1', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: `outputs/workflow-simplification/xero-${testInfo.project.name}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Waiting (1)', exact: true }).click();
    await expect(page.getByRole('cell', { name: /Waiting for invoice sync or Xero approval/ })).toBeVisible();
    await page.getByRole('button', { name: 'Ready to sync (1)', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'TEST-INV-1' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Review and sync selected', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('TEST-INV-1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('TEST-INV-2', { exact: true })).not.toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm and sync', exact: true }).click();
    const writes = await page.evaluate(() => window.workflowFixture.requests.filter((row) => row.name === 'xeroFinancialSyncRun'));
    expect(writes).toHaveLength(1); expect(writes[0].body).toMatchObject({ reviewed: true, selectedItemIds: ['doc-ready'] });
    await expect(page.getByRole('alert')).toContainText('no Xero transactions');
  });
  test('mapping repair refreshes in place', async ({ page }) => {
    await page.goto('/e2e/fixtures/financial-workflows.html');
    await page.getByRole('button', { name: 'Fix mapping', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption('200');
    await dialog.getByRole('button', { name: 'Approve mapping', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.workflowFixture.requests.filter((row) => row.name === 'xeroFinancialSyncPreview').length)).toBe(1);
  });
  test('party cards and four stages retain the current agreement', async ({ page }, testInfo) => {
    await page.goto('/e2e/fixtures/financial-workflows.html?scenario=prepare');
    await page.getByRole('button', { name: 'Complete agreement', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('navigation', { name: 'Dispute progress' })).toContainText('PrepareApproveSettleClosed');
    await expect(dialog.locator('article')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Add Commercial Outcome' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Submit for Approval', exact: true })).toBeEnabled();
    await dialog.locator('article').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `outputs/workflow-simplification/dispute-${testInfo.project.name}.png`, animations: 'disabled' });
  });
  test('verified zero-balance case offers approval and closure together', async ({ page }) => {
    await page.goto('/e2e/fixtures/financial-workflows.html?scenario=approve');
    await page.getByRole('button', { name: 'Review agreement', exact: true }).click();
    await page.getByRole('button', { name: 'Approve and close', exact: true }).click();
    await expect(page.getByRole('dialog').last()).toContainText('Test Buyer');
    await expect(page.getByRole('dialog').last().getByRole('button', { name: /Approve and close/i })).toBeEnabled();
  });
  test('last settlement offers combined close without mandatory instruction stage', async ({ page }) => {
    await page.goto('/e2e/fixtures/financial-workflows.html?scenario=settle');
    await page.getByRole('button', { name: 'Record settlement', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Test Buyer' }).getByRole('button', { name: 'Update', exact: true }).click();
    const modal = page.getByRole('dialog').last();
    await modal.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Not Required', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Record settlement and close', exact: true })).toBeEnabled();
    await expect(modal.getByText('Instruction Reference', { exact: true })).not.toBeVisible();
  });
  test('verified supplier refund fills the final settlement and keeps its evidence identity', async ({ page }) => {
    await page.goto('/e2e/fixtures/financial-workflows.html?scenario=refund');
    await page.getByRole('button', { name: 'Record settlement', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Manage', exact: true }).click();
    const modal = page.getByRole('dialog').last();
    await modal.getByRole('button', { name: 'Use verified details', exact: true }).click();
    await modal.getByRole('button', { name: 'Record settlement and close', exact: true }).click();
    const writes = await page.evaluate(() => window.workflowFixture.requests.filter((row) => row.name === 'disputeWorkflowSupplierInstructionUpdate'));
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({ instructionId: 'instruction', closeAfter: true, evidenceId: 'salesforce-payment:refund', evidenceFingerprint: 'verified-refund', recoveryMethod: 'cash_refund', matchedSalesforcePaymentId: 'refund', settlementReference: 'TEST-REFUND-1', settlementAmount: 100 });
  });
});
