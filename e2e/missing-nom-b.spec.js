import { expect, test } from '@playwright/test';

const fixturePath = '/e2e/fixtures/missing-nom-b.html';
const nomBFile = { name: 'buyer-nom-b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nsynthetic Nom B fixture') };
const filing = (page) => page.getByLabel('Missing Nom B filing', { exact: true });
const rows = (page) => page.getByRole('region', { name: 'Missing Nom B confirmations' }).getByRole('row');
const row = (page, stem) => rows(page).filter({ hasText: stem });
const input = (page, stem) => row(page, stem).locator(`input[aria-label="Choose or drop Nom B for ${stem}"]`);
const dropArea = (page, stem) => row(page, stem).getByRole('group', { name: `Choose or drop Nom B for ${stem}` });
const requestCount = (page, name) => page.evaluate((target) => window.missingNomBFixture.requests.filter((request) => request.name === target).length, name);
async function dropFiles(target, files) {
  await target.evaluate((element, definitions) => {
    const transfer = new DataTransfer();
    for (const definition of definitions) {
      const bytes = Uint8Array.from(atob(definition.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], definition.name, { type: definition.mimeType }));
    }
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files.map((file) => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString('base64') })));
}

test.beforeEach(async ({ page, baseURL }) => {
  page.fixtureErrors = [];
  page.providerRequests = [];
  page.on('pageerror', (error) => page.fixtureErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') page.fixtureErrors.push(message.text()); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin || url.pathname.startsWith('/api/')) { page.providerRequests.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.goto(fixturePath);
  await expect(page.getByRole('tab', { name: 'Nom B Filing', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(filing(page)).toBeVisible();
  await expect(row(page, 'STEM-001')).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(page.fixtureErrors).toEqual([]); expect(page.providerRequests).toEqual([]); });

test('embedded table applies the September cutoff, cursor pages, search, refresh and STEM detail', async ({ page }) => {
  await expect(row(page, 'STEM-001')).toContainText('Synthetic Marine Fuels Holdings Limited');
  await expect(row(page, 'STEM-001')).toContainText('BC-001');
  await expect(row(page, 'STEM-002')).toContainText('🟢 marker only');
  await expect(page.getByText('Delivery from 1 September 2026', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/missing-nom-b-embedded-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(row(page, 'STEM-003')).toBeVisible();
  await expect(row(page, 'STEM-001')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body.cursor)).toBe('page-2');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await row(page, 'STEM-001').getByRole('button', { name: 'STEM-001', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Opened fixture STEM' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await requestCount(page, 'missingNomBList');
  await page.getByRole('button', { name: 'Refresh filing list' }).click();
  await expect.poll(() => requestCount(page, 'missingNomBList')).toBeGreaterThan(before);
  await expect(page.getByText('Checked 30 Sept 2026, 12:00 HKT')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search missing Nom B' }).fill('skip');
  await expect(page.getByText('No confirmations on this page')).toBeVisible();
  await expect(page.getByText('No missing Nom B documents')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body)).toEqual({ cursor: null, search: 'skip' });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(row(page, 'STEM-003')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search missing Nom B' }).fill('none');
  await expect(page.getByText('No matching confirmations')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
});

test('server fixture includes the September 1 boundary and excludes earlier, invalid or undated delivery', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search missing Nom B' });
  await search.fill('STEM-005');
  await expect(row(page, 'STEM-005')).toBeVisible();
  await expect(row(page, 'STEM-005')).toContainText('01 Sept 2026');
  await search.fill('STEM-007');
  await expect(row(page, 'STEM-007')).toBeVisible();
  for (const excluded of ['STEM-004', 'STEM-006', 'STEM-008']) {
    await search.fill(excluded);
    await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((item) => item.name === 'missingNomBList').at(-1)?.body.search)).toBe(excluded);
    await expect(page.getByText('No matching confirmations')).toBeVisible();
  }
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
});

test('a stale cutoff-policy cursor restarts once at the first page with search retained', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search missing Nom B' }).fill('STEM');
  await expect.poll(() => page.evaluate(() => window.missingNomBFixture.requests.filter((item) => item.name === 'missingNomBList').at(-1)?.body.search)).toBe('STEM');
  await expect(row(page, 'STEM-001')).toBeVisible();
  await page.evaluate(() => { window.missingNomBFixture.cursorInvalidOnce = true; });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('The filing list changed. Restarting from the first page.')).toBeVisible();
  await expect(row(page, 'STEM-001')).toBeVisible();
  const requests = await page.evaluate(() => window.missingNomBFixture.requests.filter((item) => item.name === 'missingNomBList').map((item) => item.body));
  expect(requests.at(-2)).toEqual({ cursor: 'page-2', search: 'STEM' });
  expect(requests.at(-1)).toEqual({ cursor: null, search: 'STEM' });
});

test('drop rejects wrong type, oversize and multiple files; one valid drop sends once and removes only after fresh list', async ({ page }) => {
  await input(page, 'STEM-001').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('Choose a PDF');
  await input(page, 'STEM-001').setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(3 * 1024 * 1024 + 1, 1) });
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('3 MiB');
  await dropFiles(dropArea(page, 'STEM-001'), [nomBFile, { ...nomBFile, name: 'second.pdf' }]);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('exactly one');
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
  await dropFiles(filing(page), [nomBFile]);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
  await page.evaluate(() => { window.missingNomBFixture.deferUpload = true; });
  await dropFiles(dropArea(page, 'STEM-001'), [nomBFile]);
  await expect.poll(() => requestCount(page, 'missingNomBUpload')).toBe(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(input(page, 'STEM-003')).toBeDisabled();
  await dropFiles(dropArea(page, 'STEM-003'), [nomBFile]);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(1);
  await page.evaluate(() => window.missingNomBFixture.releaseUpload());
  await expect(row(page, 'STEM-001')).toHaveCount(0);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(1);
});

test('uncertain result survives reload and reuses the same operation only for identical file bytes', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['uncertain']; });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('could not be verified');
  const firstOperation = await page.evaluate(() => window.missingNomBFixture.uploads[0].operationId);
  await page.reload();
  await expect(filing(page).getByText('is unresolved', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(input(page, 'STEM-003')).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await input(page, 'STEM-001').setInputFiles({ ...nomBFile, buffer: Buffer.from('%PDF-1.7\nDIFFERENT synthetic bytes') });
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('does not match');
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001')).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads[0].operationId)).toBe(firstOperation);
});

test('unresolved upload remains recoverable when its row disappears from the visible list', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['uncertain', 'before_cutoff', 'success']; });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('could not be verified');
  const firstOperation = await page.evaluate(() => window.missingNomBFixture.uploads[0].operationId);
  await page.evaluate(() => { window.missingNomBFixture.filingRows[0].deliveryDate = '2026-08-31'; window.missingNomBFixture.filingRows[0].expectedDeliveryDate = '2026-09-05'; });
  await page.getByRole('button', { name: 'Refresh filing list' }).click();
  const recovery = filing(page).getByRole('group', { name: 'Retry the unfinished Nom B for STEM-001' });
  await expect(recovery).toBeVisible();
  await recovery.locator('input[type=file]').setInputFiles(nomBFile);
  await expect(filing(page).getByText('earlier upload is still unresolved', { exact: false })).toBeVisible();
  await expect(recovery).toBeVisible();
  await recovery.locator('input[type=file]').setInputFiles(nomBFile);
  await expect(recovery).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.at(-1).operationId)).toBe(firstOperation);
});

test('fresh cutoff and unverified-date rejections unlock correction without a filed claim', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['before_cutoff', 'date_unverified']; });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('before 1 September 2026');
  await expect(filing(page).getByText('is unresolved', { exact: false })).toHaveCount(0);
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('could not be verified');
  await expect(filing(page).getByText('is unresolved', { exact: false })).toHaveCount(0);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(2);
});

test('definite rejection allows correction; unverified green and later ownership rejection keep the same operation', async ({ page }) => {
  await page.evaluate(() => { window.missingNomBFixture.uploadResponses = ['rejected', 'unverified', 'not_owner', 'success']; });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('file contents');
  await expect(filing(page).getByText('is unresolved', { exact: false })).toHaveCount(0);
  await input(page, 'STEM-001').setInputFiles({ ...nomBFile, name: 'corrected-nom-b.pdf' });
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('could not be verified');
  const unresolvedId = await page.evaluate(() => window.missingNomBFixture.uploads.at(-1).operationId);
  await input(page, 'STEM-001').setInputFiles({ ...nomBFile, name: 'corrected-nom-b.pdf' });
  await expect(row(page, 'STEM-001').getByRole('alert')).toContainText('earlier upload is still unresolved');
  await expect(filing(page).getByText('is unresolved', { exact: false })).toBeVisible();
  await input(page, 'STEM-001').setInputFiles({ ...nomBFile, name: 'corrected-nom-b.pdf' });
  await expect(row(page, 'STEM-001')).toHaveCount(0);
  expect(await page.evaluate(() => window.missingNomBFixture.uploads.at(-1).operationId)).toBe(unresolvedId);
});

test('non-owner confirmation cannot upload or select another owner', async ({ page }) => {
  await expect(row(page, 'STEM-002')).toContainText('🟢 marker only');
  await expect(input(page, 'STEM-002')).toBeDisabled();
  await dropFiles(dropArea(page, 'STEM-002'), [nomBFile]);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
  await expect(page.getByLabel(/owner|trader selection/i)).toHaveCount(0);
});

test('leaving filing during file preparation sends nothing after the pending calculation completes', async ({ page }) => {
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (...args) => new Promise((resolve, reject) => { window.releaseNomBDigest = () => original(...args).then(resolve, reject); });
  });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect.poll(() => page.evaluate(() => typeof window.releaseNomBDigest)).toBe('function');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.evaluate(() => window.releaseNomBDigest());
  await expect(page.getByText('Synthetic commitment', { exact: true })).toBeVisible();
  expect(await requestCount(page, 'missingNomBUpload')).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('fcos:missing-nom-b:pending-upload:v1'))).toBe(null);
});

test('verified upload with local cleanup failure offers metadata-only completion', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (...args) { if (args[0] === 'fcos:missing-nom-b:pending-upload:v1') throw new Error('Synthetic storage failure'); return original.apply(this, args); };
    window.restoreNomBStorage = () => { Storage.prototype.removeItem = original; };
  });
  await input(page, 'STEM-001').setInputFiles(nomBFile);
  await expect(page.getByRole('button', { name: 'Finish confirmed upload' })).toBeVisible();
  expect(await requestCount(page, 'missingNomBUpload')).toBe(1);
  await page.evaluate(() => window.restoreNomBStorage());
  await page.getByRole('button', { name: 'Finish confirmed upload' }).click();
  await expect(page.getByRole('button', { name: 'Finish confirmed upload' })).toHaveCount(0);
  expect(await requestCount(page, 'missingNomBUpload')).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('fcos:missing-nom-b:pending-upload:v1'))).toBe(null);
});
