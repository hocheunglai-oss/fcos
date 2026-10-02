import { expect, test } from '@playwright/test';
test.describe('application draft recovery', () => {
  test.skip(process.env.FCOS_E2E_WORKFLOW_FIXTURE !== '1', 'Local fixture; every external action is stubbed.');
  test.beforeEach(async ({ page }) => { await page.goto('/e2e/fixtures/app-workflow-recovery.html'); });
  test('last keystroke survives navigation, failed save and refresh', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Last keystroke');
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Last keystroke');
    await page.getByRole('button', { name: 'Fail save' }).click();
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('Save failed');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Last keystroke');
  });
  test('changed source requires field review and recovers independent edits only', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Price', exact: true }).fill('125');
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Keep note');
    await page.getByRole('button', { name: 'Change source price' }).click();
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('125');
    await expect(page.getByRole('region', { name: 'Save status' })).toContainText('150');
    await page.getByRole('button', { name: 'Recover non-conflicting edits' }).click();
    await expect(page.getByRole('textbox', { name: 'Price', exact: true })).toHaveValue('150');
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Keep note');
    await page.getByRole('link', { name: 'Review the price' }).click();
    await expect(page.getByRole('textbox', { name: 'Price', exact: true })).toBeFocused();
  });
  test('draft never crosses a user boundary', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Private draft');
    await page.getByRole('button', { name: 'Switch user' }).click();
    await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('');
  });
  test('Special Terms reason survives closing and a failed server save', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.locator('#special-term-change-reason').fill('Clarify China delivery conditions');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Clarify China delivery conditions');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic failure' })).toBeVisible();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Clarify China delivery conditions');
  });
  test('legacy Special Terms draft recovers after authoritative hydration', async ({ page }) => {
    await page.goto('/e2e/fixtures/app-workflow-recovery.html?legacy=1');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.locator('#special-term-change-reason').fill('Keep legacy clarification');
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await page.getByRole('button', { name: 'Toggle Special Terms' }).click();
    await expect(page.locator('#special-term-change-reason')).toHaveValue('Keep legacy clarification');
    await expect(page.getByText('Preparing all legacy clauses and exact Clause Library matches…')).toHaveCount(0);
  });
  test('methodology loads its full source text on demand', async ({ page }) => {
    let requests = 0;
    await page.route('**/page-methodologies.json', async (route) => { requests += 1; await route.continue(); });
    await expect(page.getByRole('button', { name: 'Open methodology' })).toBeVisible();
    expect(requests).toBe(0);
    await page.getByRole('button', { name: 'Open methodology' }).click();
    await expect(page.getByRole('dialog')).toContainText('Authority and approvals');
    await expect(page.getByRole('dialog')).toContainText('immutable revisions');
    expect(requests).toBe(1);
  });
  test('failed methodology retrieval can be retried', async ({ page }) => {
    await page.route('**/page-methodologies.json', (route) => route.fulfill({ status: 503, body: '' }), { times: 1 });
    await page.getByRole('button', { name: 'Open methodology' }).click();
    await expect(page.getByRole('dialog')).toContainText('could not be loaded');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('immutable revisions');
  });
  test('related reference search retains the STEM and does not attach the message', async ({ page }) => {
    await page.getByText('Find related STEM or invoice', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Related STEM or invoice reference' }).fill('TEST-INV-2026');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('link', { name: 'TEST-INV-2026' })).toHaveAttribute('href', '/stems/a0H000000000001AAA');
    expect(await page.evaluate(() => window.recoveryFixture.calls.map((call) => call.name))).toEqual(['workspaceSearch']);
  });
  test('STEM workspace retains context across related work and reports partial activity', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle STEM workspace' }).click();
    await expect(page.getByText('STEM workspace', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Related STEM work' }).getByRole('link', { name: 'Variable charges' })).toHaveAttribute('href', '/payment-collections?tab=variable-charges&stemId=a0H000000000001AAA');
    await expect(page.getByText('Collection reviewed')).toBeVisible();
    await expect(page.getByText('Unavailable: Variable charges. Other activity is shown.')).toBeVisible();
  });
  test('document opens metadata before download and refuses an expired session', async ({ page }) => {
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('HKD');
    await expect(dialog).toContainText('Issued');
    await expect(dialog).toContainText('Your session has expired');
    await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    expect(downloads).toHaveLength(0);
  });
  test('Master Contract draft survives closing the editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Open contract', exact: true }).click();
    const title = page.getByRole('dialog').getByText('Title *', { exact: true }).locator('..').locator('input');
    await title.fill('China contract draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Open contract', exact: true }).click();
    await expect(title).toHaveValue('China contract draft');
  });
});
