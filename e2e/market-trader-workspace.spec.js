import { expect, test } from '@playwright/test';

test.describe('Personal Markets workspace fixture', () => {
  test('loads the personal view, records one visit, and keeps source evidence visible', async ({ page }, testInfo) => {
    await page.goto('/e2e/fixtures/market-trader-workspace.html');
    await expect(page.getByRole('heading', { name: 'My Markets' })).toBeVisible();
    await expect(page.getByText('Singapore VLSFO Oct 2026').first()).toBeVisible();
    await expect(page.getByText('+8.50 USD/MT').first()).toBeVisible();
    await expect(page.getByText('Assessed price · Asia MOC · AMFSA00 · page 5')).toBeVisible();
    await expect(page.getByText('Spread move')).toBeVisible();
    await expect(page.getByText('Assessed price · Asia MOC · AMFSA00 / PPXDK00 · page 5')).toBeVisible();
    await expect(page.getByText('One saved series has no trend points.')).toBeVisible();
    await expect(page.getByText('singapore:vlsfo:oct26')).toHaveCount(0);
    await expect(page.getByText('expired-series-key')).toHaveCount(0);
    const datedHistory = page.getByRole('link', { name: 'View history for this date' }).first();
    await expect(datedHistory).toHaveAttribute('href', '/markets?tab=curves&marketBriefMode=historical&marketBriefDate=2026-08-30');
    const spreadChange = page.locator('.market-trader__feed > article').filter({ hasText: 'Spread move' });
    await expect(spreadChange.getByRole('link', { name: 'View history for this date' })).toHaveAttribute('href', '/markets?tab=curves&marketBriefMode=historical&marketBriefDate=2026-08-30');
    await expect.poll(() => page.evaluate(() => window.__marketTraderCalls.filter((call) => call.payload?.action === 'visit').length)).toBe(1);
    const calls = await page.evaluate(() => window.__marketTraderCalls);
    expect(calls.every((call) => call.options?.cache === false)).toBe(true);
    await page.screenshot({ path: `outputs/market-trader-workspace/${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
  });

  test('saves pins, comparison labels, and in-app alert actions with current revisions', async ({ page }) => {
    await page.goto('/e2e/fixtures/market-trader-workspace.html');
    await expect(page.getByRole('heading', { name: 'My Markets' })).toBeVisible();

    await page.getByRole('button', { name: 'Manage pins' }).click();
    const unavailablePin = page.locator('.market-trader__series-options label').filter({ hasText: 'Unavailable series' });
    await expect(unavailablePin).toContainText('Unselect it to remove.');
    await unavailablePin.getByRole('checkbox').uncheck();
    await page.getByPlaceholder('Search port, product, month or symbol').fill('Rotterdam');
    await page.getByText('Rotterdam VLSFO Nov 2026').click();
    await page.getByRole('button', { name: 'Save pins' }).click();
    await expect(page.getByText('Pinned markets saved.')).toBeVisible();
    await expect(page.getByText('Rotterdam VLSFO Nov 2026').first()).toBeVisible();
    await expect(page.getByText('Trend unavailable')).toBeVisible();
    await expect(page.getByText('Posted price · Posted session · Bunkerwire · AAWYZ00 · p.7')).toBeVisible();

    const label = page.getByLabel('Edit label for Singapore clean vs residual');
    await label.fill('Singapore fuel spread');
    await page.getByRole('button', { name: 'Save label' }).click();
    await expect(page.getByText('Comparison label saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Acknowledged', exact: true })).toBeDisabled();
    await page.getByLabel('Snooze Singapore VLSFO moved').selectOption('8');
    await expect(page.getByText('Alert snoozed for 8 hours.')).toBeVisible();

    const mutations = await page.evaluate(() => window.__marketTraderCalls.filter((call) => call.name === 'marketTraderWorkspaceSave'));
    expect(mutations.map((call) => call.payload.action)).toEqual(['visit', 'preferences', 'preferences', 'acknowledge', 'snooze']);
    expect(mutations.every((call) => typeof call.payload.expectedRevision === 'number')).toBe(true);
    expect(mutations.at(-1).payload.eventKey).toBe('event-fixture');
    expect(mutations.find((call) => call.payload.action === 'preferences').payload.preferences.pins).not.toContain('expired-series-key');
  });

  test('reloads rather than overwriting after a revision conflict', async ({ page }) => {
    await page.goto('/e2e/fixtures/market-trader-workspace.html?state=conflict');
    await expect(page.getByRole('heading', { name: 'My Markets' })).toBeVisible();
    await page.getByRole('button', { name: 'Manage pins' }).click();
    await page.getByText('Rotterdam VLSFO Nov 2026').click();
    await page.getByRole('button', { name: 'Save pins' }).click();
    await expect(page.getByText(/latest version has been reloaded/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close manager' })).toBeVisible();
    await expect(page.locator('.market-trader__pin-card').filter({ hasText: 'Rotterdam VLSFO Nov 2026' })).toHaveCount(0);
  });

  test('historical mode stays latest-only and performs no API or visit mutation', async ({ page }) => {
    await page.goto('/e2e/fixtures/market-trader-workspace.html?state=historical');
    await expect(page.getByRole('heading', { name: 'My Markets is latest-only' })).toBeVisible();
    await expect(page.getByText('Return to Latest to view or manage this workspace.')).toBeVisible();
    const calls = await page.evaluate(() => window.__marketTraderCalls || []);
    expect(calls).toEqual([]);
  });

  test('does not let a stale read replace a newer saved revision', async ({ page }) => {
    await page.goto('/e2e/fixtures/market-trader-workspace.html?state=stale-read');
    await expect(page.getByRole('heading', { name: 'My Markets' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__marketTraderCalls.filter((call) => call.payload?.action === 'visit').length)).toBe(1);
    await page.getByRole('button', { name: 'Refresh My Markets' }).click();
    await page.getByRole('button', { name: 'Manage pins' }).click();
    await page.getByPlaceholder('Search port, product, month or symbol').fill('Rotterdam');
    await page.getByText('Rotterdam VLSFO Nov 2026').click();
    await page.getByRole('button', { name: 'Save pins' }).click();
    await expect(page.getByText('Pinned markets saved.')).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.locator('.market-trader__pin-card').filter({ hasText: 'Rotterdam VLSFO Nov 2026' })).toBeVisible();
  });
});
