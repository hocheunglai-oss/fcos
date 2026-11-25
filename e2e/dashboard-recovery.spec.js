import { expect, test } from '@playwright/test';
const attempts = (page) => page.evaluate(() => window.dashboardRecovery.requests.filter((row) => row.name === 'dashboardAnalytics'));

test.describe('Dashboard failure recovery', () => {
  test.skip(process.env.FCOS_E2E_DASHBOARD_RECOVERY !== '1', 'Local fixture only; every provider call is stubbed.');
  test('failure settles once; Retry and Refresh are explicit, and filter changes load once', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/e2e/fixtures/dashboard-recovery.html');
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    // More than a full render/request cycle: the original loop rapidly increments this count.
    await page.waitForTimeout(500);
    expect(await attempts(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'Retry analytics' }).click();
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await attempts(page)).toHaveLength(2);
    expect((await attempts(page))[1].force).toBe(true);
    if (await page.getByRole('button', { name: /^Filters/ }).isVisible()) await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Period', { exact: true }).selectOption('last_month');
    await expect.poll(async () => (await attempts(page)).length).toBe(3);
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await attempts(page)).toHaveLength(3);
    await page.evaluate(() => { window.dashboardRecovery.mode = 'success'; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Recovered buyer', { exact: true })).toBeVisible();
    expect(await attempts(page)).toHaveLength(4);
    await expect(page.getByText('Analytics unavailable', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('an older aborted request cannot clear loading or overwrite the new result', async ({ page }) => {
    await page.goto('/e2e/fixtures/dashboard-recovery.html');
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.dashboardRecovery.mode = 'pending'; });
    await page.getByRole('button', { name: 'Retry analytics' }).click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(1);
    if (await page.getByRole('button', { name: /^Filters/ }).isVisible()) await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Period', { exact: true }).selectOption('last_month');
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(2);
    await page.evaluate(() => window.dashboardRecovery.pending[0].reject(new Error('Stale failure')));
    await expect(page.getByText('Loading analytics…', { exact: true })).toBeVisible();
    await expect(page.getByText('Stale failure', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.dashboardRecovery.pending[1].resolve({ data: { rankings: { accountsByNetPnl: [{ accountId: 'new', name: 'Latest buyer', netPnl: 1 }] } } }));
    await expect(page.getByText('Latest buyer', { exact: true })).toBeVisible();
    expect(await attempts(page)).toHaveLength(3);
  });
});

const SELECTION_FIXTURE = '/e2e/fixtures/dashboard-recovery.html?selection';
const SUMMARY = 'dashboardSummary';
const ANALYTICS = 'dashboardAnalytics';
const STEM_LIST = 'dashboardStemList';

async function block(page, names, scope) {
  await page.evaluate(({ names, scope }) => {
    for (const name of names) window.dashboardRecovery.blocked[`${name}:${scope}`] = true;
  }, { names, scope });
}

async function unblock(page, names, scope) {
  await page.evaluate(({ names, scope }) => {
    for (const name of names) delete window.dashboardRecovery.blocked[`${name}:${scope}`];
  }, { names, scope });
}

async function settle(page, scope, count, outcome) {
  await expect.poll(() => page.evaluate((scope) => window.dashboardRecovery.pending.filter((entry) => entry.scope === scope).length, scope)).toBe(count);
  await page.evaluate(async ({ scope, outcome }) => {
    const pending = window.dashboardRecovery.pending.filter((entry) => entry.scope === scope);
    window.dashboardRecovery.pending = window.dashboardRecovery.pending.filter((entry) => entry.scope !== scope);
    await Promise.all(pending.map((entry) => entry[outcome]()));
  }, { scope, outcome });
}

async function openSelection(page) {
  // The fixture supplies synthetic data and blocks every remote browser request.
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(SELECTION_FIXTURE);
}

test.describe('Dashboard selections and actions', () => {
  test.skip(process.env.FCOS_E2E_DASHBOARD_RECOVERY !== '1', 'Local fixture only; every provider call is stubbed.');
  test.skip(({ isMobile }) => isMobile, 'Desktop scope verification.');

  test('removes prior desk figures and actions before the new load settles and recovers on Retry', async ({ page }) => {
    const resources = [SUMMARY, ANALYTICS, STEM_LIST];
    await openSelection(page);
    await expect(page.getByLabel('USD Gross Profit: 101')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ranked buyer A' })).toBeEnabled();
    await block(page, resources, 'A');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.filter((entry) => entry.scope === 'A').length)).toBe(3);
    await expect(page.getByLabel('USD Gross Profit: 101')).toBeVisible();
    await expect(page.getByLabel(/Data: Refreshing · retrieved .* Hong Kong time/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ranked buyer A' })).toBeDisabled();

    await block(page, resources, 'B');
    await page.getByRole('button', { name: 'Korea Desk', exact: true }).click();
    await expect(page.getByLabel('USD Gross Profit: 101')).toHaveCount(0);
    await expect(page.getByText('Ranked buyer A')).toHaveCount(0);
    await expect(page.getByLabel('Loading Dashboard figures')).toBeVisible();
    await settle(page, 'B', 3, 'reject');
    await expect(page.getByText('dashboardSummary unavailable for desk B')).toBeVisible();
    await expect(page.getByText('Analytics unavailable', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'STEMs' }).click();
    await expect(page.getByText('dashboardStemList unavailable for desk B')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export XLS' })).toBeDisabled();
    await expect(page.getByText('STEM A ordinary')).toHaveCount(0);
    await expect(page.getByText('No matching STEMs', { exact: true })).toHaveCount(0);

    await unblock(page, resources, 'B');
    await page.getByRole('alert').filter({ hasText: STEM_LIST }).getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('cell', { name: 'STEM B ordinary' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buyer B' })).toBeEnabled();
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.getByRole('alert').filter({ hasText: SUMMARY }).getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('button', { name: 'Retry analytics' }).click();
    await expect(page.getByLabel('USD Gross Profit: 202')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ranked buyer B' })).toBeEnabled();
    await settle(page, 'A', 3, 'resolve');
    await expect(page.getByLabel('USD Gross Profit: 101')).toHaveCount(0);
    await expect(page.getByText('Ranked buyer A')).toHaveCount(0);
    const oldAborted = await page.evaluate(() => window.dashboardRecovery.requests.filter((entry) => entry.scope === 'A' && entry.force).every((entry) => entry.signal.aborted));
    expect(oldAborted).toBe(true);
  });

  test('cancels an in-flight XLS and retries the selected search and page after failures', async ({ page }) => {
    const downloads = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await openSelection(page);
    await page.getByRole('tab', { name: 'STEMs' }).click();
    const exportButton = page.getByRole('button', { name: 'Export XLS' });
    await expect(exportButton).toBeEnabled();
    await page.evaluate(() => { window.dashboardRecovery.holdExport = true; });
    await exportButton.click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(1);
    await block(page, [STEM_LIST], 'B');
    await page.getByRole('button', { name: 'Korea Desk', exact: true }).click();
    await expect(exportButton).toBeDisabled();
    await expect(page.getByText('STEM A ordinary')).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardRecovery.pending[0].signal.aborted)).toBe(true);
    await settle(page, 'A', 1, 'resolve');
    await settle(page, 'B', 1, 'reject');
    await expect(exportButton).toBeDisabled();
    expect(downloads).toEqual([]);

    await unblock(page, [STEM_LIST], 'B');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'STEM B ordinary' })).toBeVisible();
    await page.getByRole('cell', { name: 'STEM B ordinary' }).click();
    await expect(page.getByText('Detail B-ordinary').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await block(page, [STEM_LIST], 'B');
    const search = page.getByRole('textbox', { name: 'Search STEMs' });
    await search.fill('needle');
    await search.press('Enter');
    await expect(exportButton).toBeDisabled();
    await expect(page.getByText('STEM B ordinary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Buyer B' })).toHaveCount(0);
    await settle(page, 'B', 1, 'reject');
    await unblock(page, [STEM_LIST], 'B');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'STEM B needle' })).toBeVisible();

    await block(page, [STEM_LIST], 'B');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
    await expect(page.getByText('STEM B needle')).toHaveCount(0);
    await settle(page, 'B', 1, 'reject');
    await unblock(page, [STEM_LIST], 'B');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'STEM B second' })).toBeVisible();
    const retry = await page.evaluate(() => window.dashboardRecovery.requests.filter((entry) => entry.name === 'dashboardStemList').at(-1));
    expect(retry).toMatchObject({ force: true, body: { cursor: 'cursor-2', search: 'needle' } });
    await page.evaluate(() => { window.dashboardRecovery.holdExport = false; });
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/Korea_Desk\.xls$/);
    expect(downloads).toEqual([download.suggestedFilename()]);
    const exported = await page.evaluate(() => window.dashboardRecovery.requests.filter((entry) => entry.name === 'dashboardStemList').at(-1).body);
    expect(exported).toMatchObject({ cursor: null, search: 'needle', filters: { koreaDeskMode: 'include' } });
  });

  test('keeps Accounts directory results and exposure on the selected desk and direction', async ({ page }) => {
    const directory = 'dashboardAccountCreditDirectory';
    await openSelection(page);
    await page.getByRole('tab', { name: 'Accounts' }).click();
    await expect(page.getByRole('cell').filter({ hasText: 'Directory A both' })).toBeVisible();
    await block(page, [directory], 'B');
    await page.getByRole('button', { name: 'Korea Desk', exact: true }).click();
    await expect(page.getByText('Directory A both')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Insight' })).toHaveCount(0);
    await settle(page, 'B', 1, 'reject');
    await expect(page.getByText(`${directory} unavailable for desk B`)).toBeVisible();
    await unblock(page, [directory], 'B');
    await page.getByRole('button', { name: 'Refresh Accounts' }).click();
    await expect(page.getByRole('cell').filter({ hasText: 'Directory B both' })).toBeVisible();

    await block(page, [directory], 'B');
    await page.getByRole('button', { name: 'Supplier', exact: true }).click();
    await expect(page.getByText('Directory B both')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Statement' })).toHaveCount(0);
    await settle(page, 'B', 1, 'resolve');
    await expect(page.getByRole('cell').filter({ hasText: 'Directory B supplier' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Statement' })).toBeEnabled();
    const exposureEntities = await page.evaluate(() => window.dashboardRecovery.requests
      .filter((entry) => entry.name === 'dashboardAccountExposureBatch' && entry.scope === 'B')
      .flatMap((entry) => entry.body.entities.map((entity) => entity.entityId)));
    expect(exposureEntities).toEqual(['B-both', 'B-supplier']);
  });

  test('cancels an EBIT download when finance settings change and waits for a current summary', async ({ page }) => {
    const downloads = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await openSelection(page);
    await expect(page.getByLabel('USD Gross Profit: 101')).toBeVisible();
    await page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' }).click();
    await page.getByRole('tab', { name: 'STEMs' }).click();
    const exportButton = page.getByRole('button', { name: 'Export XLS' });
    await expect(exportButton).toBeEnabled();
    await page.evaluate(() => { window.dashboardRecovery.holdExport = true; });
    await exportButton.click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(1);

    await block(page, [SUMMARY], 'A');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fcos:finance-settings-updated')));
    await expect(exportButton).toBeDisabled();
    await expect(page.getByRole('cell', { name: 'STEM A ordinary' })).toBeVisible();
    expect(await page.evaluate(() => window.dashboardRecovery.pending[0].signal.aborted)).toBe(true);
    await page.evaluate(async () => {
      const fixture = window.dashboardRecovery;
      await fixture.pending.shift().resolve();
    });
    await settle(page, 'A', 1, 'reject');
    await expect(exportButton).toBeDisabled();
    expect(downloads).toEqual([]);
    await unblock(page, [SUMMARY], 'A');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(exportButton).toBeEnabled();
  });

  test('discards a late AI result when the desk changes without aborting a pending finance summary on AI success', async ({ page }) => {
    await openSelection(page);
    await expect(page.getByLabel('USD Gross Profit: 101')).toBeVisible();
    await page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'AI search', exact: true }).click();
    const aiInput = page.getByRole('textbox', { name: 'AI search' });
    const aiApply = page.getByRole('button', { name: 'Apply', exact: true });
    await block(page, ['dashboardAiSearch'], 'A');
    await aiInput.fill('old scope');
    await aiApply.click();
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(1);
    await page.getByRole('button', { name: 'Korea Desk', exact: true }).click();
    await expect(aiApply).toBeEnabled();
    await settle(page, 'A', 1, 'resolve');
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

    await block(page, [SUMMARY, 'dashboardAiSearch'], 'B');
    await aiInput.fill('selected scope');
    await aiApply.click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fcos:finance-settings-updated')));
    await expect.poll(() => page.evaluate(() => window.dashboardRecovery.pending.length)).toBe(2);
    await page.evaluate(async () => {
      const fixture = window.dashboardRecovery;
      const ai = fixture.pending.find((entry) => entry.name === 'dashboardAiSearch');
      fixture.pending = fixture.pending.filter((entry) => entry !== ai);
      await ai.resolve();
    });
    await expect(page.getByRole('cell', { name: 'STEM B selected scope' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export XLS' })).toBeDisabled();
    expect(await page.evaluate(() => window.dashboardRecovery.pending[0].signal.aborted)).toBe(false);
    await settle(page, 'B', 1, 'resolve');
    await page.getByRole('button', { name: 'Clear AI search' }).click();
    await expect(page.getByRole('button', { name: 'Export XLS' })).toBeEnabled();
  });
});
