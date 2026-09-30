import { expect, test } from '@playwright/test';

const fixturePath = '/e2e/fixtures/nom-b.html';
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
});
test.afterEach(async ({ page }) => { expect(page.fixtureErrors).toEqual([]); expect(page.providerRequests).toEqual([]); });
const panel = (page) => page.getByRole('region', { name: 'Missing Nom B requirements', exact: true });
const openList = async (page, suffix = '') => {
  await page.goto(`${fixturePath}${suffix}`);
  await expect(page.getByRole('heading', { name: 'My Commitments', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Nom B Filing', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('My missing Nom B count: 26', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide STEMs', exact: true })).toBeVisible();
};

test('personal filing opens expanded, stays separate from ordinary commitments and Dashboard, and keeps policy access without evidence or external links', async ({ page }) => {
  await openList(page);
  const section = panel(page);
  await expect(section.getByRole('heading', { name: /STEM-001.*Pacific Endeavour/ })).toBeVisible();
  await expect(section.getByText('Actual delivery', { exact: true }).first()).toBeVisible();
  await expect(section.getByText('Expected delivery', { exact: true }).first()).toBeVisible();
  await expect(section.getByRole('button', { name: 'Manage Nom B' })).toHaveCount(0);
  await expect(section.getByLabel('Requirements for')).toHaveCount(0);
  const uploadEntry = section.getByRole('link', { name: 'Upload missing Nom B', includeHidden: true });
  await expect(uploadEntry).toHaveAttribute('href', '/missing-nom-b');
  if (test.info().project.name === 'desktop') await expect(uploadEntry).toBeVisible();
  else await expect(uploadEntry).toBeHidden();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/nom-b-${test.info().project.name}.png` });
  const before = await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardNomBRead').length);
  await expect(page.getByLabel('Period', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic commitment', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'workCommitmentsList' || request.name === 'dashboardSummary').length)).toBe(0);
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(page.getByText('Synthetic commitment', { exact: true })).toBeVisible();
  await expect(section).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardNomBRead').length)).toBe(before);
  await page.getByRole('tab', { name: 'Nom B Filing', exact: true }).click();
  await expect(section.getByRole('heading', { name: /STEM-001.*Pacific Endeavour/ })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Hide STEMs', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic commitment', { exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'View policy' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Read-only.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
  await expect(dialog.getByText('Original receivable', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardNomBAuditRead').length)).toBe(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(section.getByRole('button', { name: 'Receivable & audit' })).toHaveCount(0);
  await expect(section.locator('a[href^="http"]')).toHaveCount(0);
  await section.getByRole('button', { name: 'Open STEM', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'salesforceStemDetail').at(-1)?.body.stemId)).toBe('fixture-stem-1');
  await expect(page.getByRole('dialog')).toContainText('Opened fixture STEM');
  await page.goto(`${fixturePath}?screen=dashboard`);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardSummary').length)).toBeGreaterThan(0);
  await expect(panel(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name.startsWith('dashboardNomB')).length)).toBe(0);
});

test('desktop Nom B Filing opens the all-date upload list and owned confirmation dialog', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The new upload entry is desktop-only.');
  await openList(page);
  const section = panel(page);
  await expect(section.getByText('The filing page shows missing Nom B across all dates. Choose Upload Nom B beside a Buyer Confirmation.')).toBeVisible();
  await section.getByRole('link', { name: 'Upload missing Nom B' }).click();
  await expect(page.getByRole('heading', { name: 'Missing Nom B', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Missing Nom B confirmations' }).getByRole('row').filter({ hasText: 'STEM-001' })).toContainText('Synthetic Marine Fuels Holdings Limited');
  await expect.poll(() => page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'missingNomBList').at(-1)?.body)).toEqual({ cursor: null, search: '' });
  await page.getByRole('row').filter({ hasText: 'STEM-001' }).getByRole('button', { name: 'Upload Nom B' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Nom B' });
  await expect(dialog).toContainText('BC-001');
  await expect(dialog.getByLabel('Nom B document')).toBeVisible();
  await expect(page.getByLabel(/owner|trader selection/i)).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'missingNomBUpload').length)).toBe(0);
});

test('status tabs, undated-only follow-up, search, sorting and paging use their own server payload', async ({ page }) => {
  await openList(page);
  const section = panel(page);
  await section.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(section.getByRole('heading', { name: /STEM-026/ })).toBeVisible();
  await expect(section.getByText('Page 2 of 2 · 26 STEMs')).toBeVisible();
  await section.getByRole('tab', { name: /^Waived/ }).click();
  await expect(section.getByRole('heading', { name: /STEM-027/ })).toBeVisible();
  await expect(section.getByText('Automatic waiver', { exact: true })).toBeVisible();
  await section.getByRole('tab', { name: /^Unable to verify/ }).click();
  await expect(section.getByText('Issued-invoice currency could not be verified.')).toBeVisible();
  await section.getByRole('tab', { name: /^Missing/ }).click();
  await section.getByLabel(/^Undated follow-up/).check();
  await expect(section.getByRole('heading', { name: /STEM-029/ })).toBeVisible();
  await expect(section.getByRole('heading', { name: /STEM-001/ })).toHaveCount(0);
  await expect(section.getByText('Undated · follow up')).toBeVisible();
  await section.getByLabel(/^Undated follow-up/).uncheck();
  await section.getByLabel('Search STEM, vessel, buyer, port or trader').fill('Pacific');
  await section.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(section.getByRole('heading', { name: /STEM-001/ })).toBeVisible();
  await section.getByLabel('Sort', { exact: true }).selectOption('delivery_desc');
  await expect.poll(() => page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardNomBRead' && request.body.search === 'Pacific').at(-1)?.body.sort)).toBe('delivery_desc');
  const requests = await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name === 'dashboardNomBRead'));
  for (const request of requests) { expect(request.body).not.toHaveProperty('dateWindows'); expect(request.body).not.toHaveProperty('filters'); }
});

test('management defaults Payment Received, validates reasons and uses server revision; team includes unresolved assignments', async ({ page }) => {
  await openList(page, '?role=manager');
  const section = panel(page);
  await section.getByRole('button', { name: 'Manage Nom B' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom B requirement').selectOption('waive');
  await expect(dialog.getByLabel('Waiver reason')).toHaveValue('payment_received');
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toBeEnabled();
  await dialog.getByLabel('Waiver reason').selectOption('other');
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toBeDisabled();
  await dialog.getByLabel('Explanation (required)').fill('   ');
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toBeDisabled();
  await dialog.getByLabel('Nom B requirement').selectOption('require');
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toBeDisabled();
  await dialog.getByLabel('Nom B requirement').selectOption('waive');
  await dialog.getByLabel('Explanation (required)').fill('  Reviewed supporting payment evidence.  ');
  await dialog.getByRole('button', { name: 'Save policy' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.saves.at(-1))).toEqual({ stemId: 'fixture-stem-1', mode: 'waive', reasonCode: 'other', reasonText: 'Reviewed supporting payment evidence.', expectedRevision: 0 });
  await expect(page.getByLabel('My missing Nom B count: 25', { exact: true })).toBeVisible();
  await section.getByLabel('Requirements for').selectOption('team');
  await section.getByLabel('Trader', { exact: true }).selectOption('unassigned');
  await expect(section.getByRole('heading', { name: /STEM-030/ })).toBeVisible();
  await expect(section.getByText('Trader: Unresolved assignment', { exact: true })).toBeVisible();
  await expect(page.getByLabel('My missing Nom B count: 25', { exact: true })).toBeVisible();
});

test('conflicts and storage failure preserve draft; reopening uses refreshed revision and never resubmits automatically', async ({ page }) => {
  await openList(page, '?role=manager');
  await page.evaluate(() => { window.nomBFixture.mutation = 'conflict'; });
  const section = panel(page);
  await section.getByRole('button', { name: 'Manage Nom B' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom B requirement').selectOption('require');
  await dialog.getByLabel('Explanation (required)').fill('Keep this entered explanation.');
  await dialog.getByRole('button', { name: 'Save policy' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your text is retained');
  await expect(dialog.getByLabel('Explanation (required)')).toHaveValue('Keep this entered explanation.');
  await expect(dialog.getByRole('button', { name: 'Save policy' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Refresh list' }).click();
  await expect(dialog.getByRole('button', { name: 'Refresh list' })).toBeEnabled();
  expect(await page.evaluate(() => window.nomBFixture.saves.length)).toBe(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await section.getByRole('button', { name: 'Manage Nom B' }).first().click();
  await expect(dialog.getByLabel('Explanation (required)')).toHaveValue('Keep this entered explanation.');
  await page.evaluate(() => { window.nomBFixture.mutation = 'failure'; });
  await dialog.getByRole('button', { name: 'Save policy' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Policy storage is unavailable.');
  await expect(dialog.getByLabel('Explanation (required)')).toHaveValue('Keep this entered explanation.');
  expect(await page.evaluate(() => window.nomBFixture.saves.at(-1).expectedRevision)).toBe(1);
});

test('unknown counts never appear as zero; obsolete responses cannot replace the selected status; restricted CI skips read', async ({ page }) => {
  await page.goto(`${fixturePath}?unknown=1`);
  await expect(page.getByLabel('My missing Nom B count: Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Count incomplete.', { exact: false })).toBeVisible();
  await page.goto(`${fixturePath}?read=fail`);
  await expect(panel(page).getByRole('alert')).toContainText('Counts are unavailable');
  await expect(page.getByLabel('My missing Nom B count: Unavailable', { exact: true })).toBeVisible();
  await openList(page);
  await page.evaluate(() => { window.nomBFixture.deferView = 'missing'; });
  await page.getByRole('button', { name: 'Refresh Nom B requirements' }).click();
  await expect.poll(() => page.evaluate(() => window.nomBFixture.pending.length)).toBe(1);
  await panel(page).getByRole('tab', { name: /^Waived/ }).click();
  await expect(panel(page).getByRole('heading', { name: /STEM-027/ })).toBeVisible();
  await page.evaluate(() => { window.nomBFixture.deferView = null; window.nomBFixture.pending.splice(0).forEach((resolve) => resolve()); });
  await expect(panel(page).getByRole('heading', { name: /STEM-001/ })).toHaveCount(0);
  await expect(panel(page).getByRole('tab', { name: /^Waived/ })).toHaveAttribute('data-state', 'active');
  await page.goto(`${fixturePath}?role=ci`);
  await expect(page.getByRole('heading', { name: 'My Commitments', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Nom B Filing', exact: true })).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.nomBFixture.requests.filter((request) => request.name.startsWith('dashboardNomB')).length)).toBe(0);
});
