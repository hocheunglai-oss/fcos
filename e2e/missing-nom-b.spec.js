import { expect, test } from '@playwright/test';

const fixturePath = '/e2e/fixtures/missing-nom-b.html';
const nomBFile = { name: 'buyer-nom-b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nsynthetic Nom B fixture') };
const rows = (page) => page.getByRole('region', { name: 'Missing Nom B confirmations' }).getByRole('row');
const attachedRow = (page, stemName) => page.locator('table tbody tr').filter({ hasText: stemName });
const uploadDialog = (page) => page.getByRole('dialog', { name: 'Upload Nom B' });

test.beforeEach(async ({ page, baseURL }) => {
  page.fixtureErrors = [];
  page.providerRequests = [];
  page.on('pageerror', (error) => page.fixtureErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') page.fixtureErrors.push(message.text()); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin || url.pathname.startsWith('/api/')) {
      page.providerRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(fixturePath);
  await expect(page.getByRole('heading', { name: 'Missing Nom B', exact: true })).toBeVisible();
  await expect(attachedRow(page, 'STEM-001')).toBeAttached();
});

test.afterEach(async ({ page }) => {
  expect(page.fixtureErrors).toEqual([]);
  expect(page.providerRequests).toEqual([]);
});

test('lists all-date missing confirmations, pages by cursor, refreshes and opens STEM detail', async ({ page }) => {
  const first = rows(page).filter({ hasText: 'STEM-001' });
  await expect(first).toContainText('North Star Fuels');
  await expect(first).toContainText('Pacific Endeavour');
  await expect(first).toContainText('9000001');
  await expect(first).toContainText('18 Sept 2026');
  await expect(first).toContainText('BC-1');
  await expect(rows(page).filter({ hasText: 'STEM-002' })).toContainText('🟢 marker only');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows(page).filter({ hasText: 'STEM-003' })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'STEM-001' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body.cursor)).toBe('page-2');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await first.getByRole('button', { name: 'STEM-001' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Opened fixture STEM' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'salesforceStemDetail').at(-1)?.body.stemId)).toBe('fixture-stem-1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').length);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').length)).toBeGreaterThan(before);
  await expect(page.getByText('Checked 30 Sept 2026, 12:00 HKT')).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard fixture' })).toBeVisible();
});

test('search resets the cursor and an empty continuation page does not claim all work is done', async ({ page }) => {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows(page).filter({ hasText: 'STEM-003' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search missing Nom B' }).fill('skip');
  await expect(page.getByText('No confirmations on this page')).toBeVisible();
  await expect(page.getByText('No missing Nom B documents')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body)).toEqual({ cursor: null, search: 'skip' });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows(page).filter({ hasText: 'STEM-003' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search missing Nom B' }).fill('none');
  await expect(page.getByText('No matching confirmations')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body)).toEqual({ cursor: null, search: 'none' });
});

test('client validates type and decoded size and blocks duplicate upload clicks', async ({ page }) => {
  await rows(page).filter({ hasText: 'STEM-001' }).getByRole('button', { name: 'Upload Nom B' }).click();
  const dialog = uploadDialog(page);
  await dialog.locator('#nom-b-file').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(dialog.getByRole('alert')).toContainText('Choose a PDF');
  await expect(dialog.getByRole('button', { name: 'Upload to Salesforce' })).toBeDisabled();
  await dialog.locator('#nom-b-file').setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(3 * 1024 * 1024 + 1, 1) });
  await expect(dialog.getByRole('alert')).toContainText('3 MiB');
  await expect(dialog.getByRole('button', { name: 'Upload to Salesforce' })).toBeDisabled();
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.length)).toBe(0);
  await dialog.locator('#nom-b-file').setInputFiles(nomBFile);
  await page.evaluate(() => { window.missingNomBFixture.deferUpload = true; });
  await dialog.getByRole('button', { name: 'Upload to Salesforce' }).click();
  await expect(dialog.getByRole('button', { name: 'Retry same upload' })).toBeDisabled();
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.length)).toBe(1);
  await page.evaluate(() => window.missingNomBFixture.releaseUpload());
  await expect(dialog).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'STEM-001' })).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.length)).toBe(1);
});

test('uncertain upload retries the same operation; a reload can resume with the same file', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['uncertain']; });
  await rows(page).filter({ hasText: 'STEM-001' }).getByRole('button', { name: 'Upload Nom B' }).click();
  await uploadDialog(page).locator('#nom-b-file').setInputFiles(nomBFile);
  await uploadDialog(page).getByRole('button', { name: 'Upload to Salesforce' }).click();
  await expect(uploadDialog(page).getByRole('alert')).toContainText('outcome');
  await expect(uploadDialog(page).locator('#nom-b-file')).toBeDisabled();
  await expect(attachedRow(page, 'STEM-001')).toBeAttached();
  const firstOperation = await page.evaluate(() => window.missingNomBFixture.uploads[0].operationId);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume upload' })).toBeVisible();
  await expect(page.getByText('The Nom B upload for STEM-001', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Resume upload' }).click();
  await uploadDialog(page).locator('#nom-b-file').setInputFiles(nomBFile);
  await uploadDialog(page).getByRole('button', { name: 'Retry same upload' }).click();
  await expect(uploadDialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads[0].operationId)).toBe(firstOperation);
  await expect(page.getByRole('button', { name: 'Resume upload' })).toHaveCount(0);
});

test('definite rejection unlocks correction while an unverified green response remains unresolved', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['rejected', 'unverified', 'success']; });
  await rows(page).filter({ hasText: 'STEM-001' }).getByRole('button', { name: 'Upload Nom B' }).click();
  const dialog = uploadDialog(page);
  await dialog.locator('#nom-b-file').setInputFiles(nomBFile);
  await dialog.getByRole('button', { name: 'Upload to Salesforce' }).click();
  await expect(dialog.getByRole('alert')).toContainText('file contents');
  await expect(dialog.locator('#nom-b-file')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Resume upload' })).toHaveCount(0);
  await dialog.locator('#nom-b-file').setInputFiles({ ...nomBFile, name: 'corrected-nom-b.pdf' });
  await dialog.getByRole('button', { name: 'Upload to Salesforce' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not confirm');
  await expect(dialog.locator('#nom-b-file')).toBeDisabled();
  await expect(attachedRow(page, 'STEM-001')).toBeAttached();
  const unresolvedId = await page.evaluate(() => window.missingNomBFixture.uploads.at(-1).operationId);
  await dialog.getByRole('button', { name: 'Retry same upload' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.at(-1).operationId)).toBe(unresolvedId);
  await expect(rows(page).filter({ hasText: 'STEM-001' })).toHaveCount(0);
});

test('non-owner rows offer no client-side upload or ownership selection', async ({ page }) => {
  const nonOwner = rows(page).filter({ hasText: 'STEM-002' });
  await expect(nonOwner).toContainText('🟢 marker only');
  await expect(nonOwner.getByRole('button', { name: 'Upload Nom B' })).toBeDisabled();
  await expect(nonOwner).toContainText('Upload unavailable for this confirmation.');
  await expect(page.getByLabel(/owner|trader selection/i)).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.length)).toBe(0);
});
