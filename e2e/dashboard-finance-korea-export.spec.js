import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { read, utils } from 'xlsx';

const FIXTURE_PATH = '/e2e/fixtures/dashboard-preview.html';
const FIXTURE_ORIGIN = new URL(process.env.FCOS_E2E_BASE_URL || 'http://127.0.0.1:5173').origin;

async function expandMobileFilters(page) {
  const control = page.getByRole('button', { name: /^Filters/ });
  if (await control.isVisible() && await control.getAttribute('aria-expanded') !== 'true') await control.click();
}

async function collapseMobileFilters(page) {
  const control = page.getByRole('button', { name: /^Filters/ });
  if (await control.isVisible() && await control.getAttribute('aria-expanded') === 'true') await control.click();
}

test.describe('synthetic Dashboard EBIT, Korea, Finance settings, and XLS fixture', () => {
  test.skip(process.env.FCOS_E2E_DASHBOARD_FIXTURE !== '1', 'Opt-in local Vite fixture; no provider calls or live data.');

  test('labels complete, partial, and gross-profit-only finance states accurately', async ({ page }) => {
    await page.goto(`${FIXTURE_PATH}?finance=partial`);
    const partialToggle = page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' });
    await expect(partialToggle).not.toBeChecked();
    await partialToggle.click();
    await expect(page.getByRole('heading', { name: 'Partial EBIT', exact: true })).toBeVisible();
    await expect(page.getByLabel('USD Partial EBIT: 475,975')).toBeVisible();
    await expect(page.getByText('16 of 128 STEMs verified · 12.5%')).toBeVisible();
    await expect(page.getByText('Verified GP 488,350 − verified interest finance cost 12,000 − verified supplier bank charges 375')).toBeVisible();
    await expect(page.getByText('Full selection gross profit 2,133,350 · 112 STEMs excluded · excluded GP 1,645,000')).toBeVisible();
    await page.getByRole('button', { name: 'How calculated: Partial EBIT' }).click();
    await expect(page.getByText(/USD Partial EBIT: 475,975 \(16\/128 STEMs, 12.5% verified\)/)).toBeVisible();
    await expect(page.getByText('112 STEMs have incomplete payment evidence.')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`${FIXTURE_PATH}?finance=none`);
    const noneToggle = page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' });
    await expect(noneToggle).not.toBeChecked();
    await noneToggle.click();
    await expect(page.getByRole('heading', { name: 'Gross profit (before finance)', exact: true })).toBeVisible();
    await expect(page.getByLabel('USD Gross profit before finance: 2,133,350')).toBeVisible();
    await expect(page.getByText('EBIT unavailable · interest or bank-charge evidence missing')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Partial EBIT', exact: true })).toHaveCount(0);

    await page.goto(`${FIXTURE_PATH}?finance=complete`);
    const completeToggle = page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' });
    await expect(completeToggle).not.toBeChecked();
    await completeToggle.click();
    await expect(page.getByRole('heading', { name: 'EBIT', exact: true })).toBeVisible();
    await expect(page.getByLabel('USD EBIT: 1,889,250')).toBeVisible();
    await expect(page.getByText('Gross profit 2,133,350 − interest finance cost 241,000 − supplier bank charges 3,100')).toBeVisible();
  });

  test('keeps the full ordinary selection reviewable on desktop and mobile', async ({ page }) => {
    const browserErrors = [];
    const externalRequests = [];
    const failedResponses = [];
    const downloads = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
    page.on('request', (request) => { if (new URL(request.url()).origin !== FIXTURE_ORIGIN) externalRequests.push(request.url()); });
    page.on('download', (download) => downloads.push(download.suggestedFilename()));

    await page.goto(FIXTURE_PATH);
    await expect(page.getByText('Synthetic UI fixture — not live Salesforce data').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gross Profit', exact: true })).toBeVisible();
    const ebitToggle = page.getByRole('switch', { name: 'Show EBIT in place of Gross Profit' });
    await expect(ebitToggle).not.toBeChecked();
    await ebitToggle.click();
    await expect(ebitToggle).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Partial EBIT', exact: true })).toBeVisible();
    await expect(page.getByText('Verified STEMs only; full gross profit shown for context')).toBeVisible();
    await expect(page.getByText(/112 STEMs excluded/)).toBeVisible();
    await expect(page.getByText('5.00% annually · Actual/365')).toBeVisible();
    await expect(page.getByText('UBS USD 10.00 · DBS USD 15.00 per supplier remittance')).toBeVisible();
    await expect(page.getByText(/Calculated through 2026-09-05 · Finance revision 1/)).toBeVisible();

    await expandMobileFilters(page);
    const koreaOnly = page.getByRole('button', { name: 'Korea Desk', exact: true });
    const excludeKorea = page.getByRole('button', { name: 'Exclude Korea Desk', exact: true });
    await excludeKorea.click();
    await expect(excludeKorea).toHaveAttribute('aria-pressed', 'true');
    await expect(koreaOnly).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Exclude Korea Desk', { exact: true }).last()).toBeVisible();
    const location = page.getByLabel('Port or COUNTRY');
    await location.fill('Singapore');
    await location.press('Enter');
    await expect(excludeKorea).toHaveAttribute('aria-pressed', 'false');
    await koreaOnly.click();
    await expect(koreaOnly).toHaveAttribute('aria-pressed', 'true');
    await koreaOnly.click();
    await expect(koreaOnly).toHaveAttribute('aria-pressed', 'false');
    await excludeKorea.click();

    await collapseMobileFilters(page);
    await page.getByRole('tab', { name: 'STEMs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export XLS', exact: true })).toBeEnabled();
    await page.evaluate(() => { window.__fixtureExportDelayMs = 500; });
    await page.getByRole('button', { name: 'Export XLS', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Export cancelled. No file was downloaded.')).toBeVisible();
    expect(downloads).toEqual([]);

    await page.evaluate(() => { window.__fixtureExportDelayMs = 0; });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export XLS', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('FCOS_Dashboard_STEMs_2026-01-01_to_2026-12-31_Exclude_Korea_Desk.xls');
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const workbook = read(bytes, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['STEMs', 'Scope']);
    const records = utils.sheet_to_json(workbook.Sheets.STEMs, { header: 1 });
    expect(records).toHaveLength(202);
    expect(records[0]).toContain('Bank Charge');
    expect(records[1][0]).toBeTruthy();
    expect(records[201][0]).toBeTruthy();
    const scope = Object.fromEntries(utils.sheet_to_json(workbook.Sheets.Scope, { header: 1 }));
    expect(scope['Exported STEM rows']).toBe('201');
    expect(scope.Period).toBe('2026-01-01 to 2026-12-31');
    expect(scope['Korea Desk']).toBe('Exclude Korea Desk');
    expect(scope['Bank charge snapshot']).toBe('DBS USD 15 per remittance; UBS USD 10 per remittance');
    await expect(page.getByText('Exported 201 STEMs.')).toBeVisible();
    const exportRequests = await page.evaluate(() => window.__fixtureDashboardStemRequests);
    const completedRequests = exportRequests.slice(-2);
    expect(completedRequests).toHaveLength(2);
    expect(completedRequests[0].filters.excludedCountryCodes).toEqual(['KOREA']);
    expect(completedRequests[0].includeFinanceCosts).toBe(true);
    expect(completedRequests[1].financeSnapshot).toEqual({ annualInterestRatePct: 5, bankChargesUsd: { DBS: 15, UBS: 10 }, revision: 1, asOfDate: '2026-09-05' });

    await expandMobileFilters(page);
    await page.getByRole('button', { name: 'AI search', exact: true }).click();
    await page.getByLabel('AI search').fill('show Korea desk stems');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export XLS', exact: true })).toBeDisabled();
    await expect(page.getByText(/Export is unavailable for AI results/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear AI search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export XLS', exact: true })).toBeEnabled();

    await page.getByRole('tab', { name: 'Finance settings', exact: true }).click();
    const rate = page.getByLabel('Annual financing rate (%)');
    const ubsCharge = page.getByLabel('UBS remittance charge');
    const dbsCharge = page.getByLabel('DBS remittance charge');
    await expect(rate).toHaveValue('5.00');
    await expect(ubsCharge).toHaveValue('10.00');
    await expect(dbsCharge).toHaveValue('15.00');
    await rate.fill('100.001');
    await expect(page.getByText('Enter a percentage from 0 to 100 with no more than two decimal places.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save finance settings', exact: true })).toBeDisabled();
    await ubsCharge.fill('1000000.01');
    await expect(page.getByText('Enter USD 0–1,000,000 with no more than two decimal places.')).toBeVisible();
    await ubsCharge.fill('12.50');
    await dbsCharge.fill('20');
    await rate.fill('6.25');
    await page.getByRole('button', { name: 'Save finance settings', exact: true }).click();
    await expect(rate).toHaveValue('6.25');
    await expect(ubsCharge).toHaveValue('12.50');
    await expect(dbsCharge).toHaveValue('20.00');
    await expect(page.getByText('2', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__fixtureFinanceEvents)).toEqual([{ revision: 2 }]);

    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay') ? 'ERROR_OVERLAY' : 'OK')).toBe('OK');
    expect(externalRequests).toEqual([]);
    expect(failedResponses.filter(({ url }) => !url.endsWith('/favicon.ico') && !url.includes('/node_modules/@fontsource'))).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
});
