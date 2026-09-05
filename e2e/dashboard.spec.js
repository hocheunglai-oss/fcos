import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);

test.describe('Dashboard', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable test credentials.');
  test.use({ storageState: authState });

  test('keeps combined reference filters and all three views responsive without browser errors', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto('/');
    const dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true });
    await expect(dashboardHeading).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('tab', { name: 'STEMs', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dashboard filters' })).toBeVisible();
    const mobileFilters = page.getByRole('button', { name: /^Filters/ });
    if (await mobileFilters.isVisible()) await mobileFilters.click();
    await expect(page.getByLabel('Company or GROUP')).toBeVisible();
    await expect(page.getByLabel(/Port or (?:COUNTRY|country)/)).toBeVisible();
    for (const removedAction of ['Open P&L workspace', 'Review disputes', 'Payment collections', 'Cashflow forecast']) {
      await expect(page.getByRole('button', { name: removedAction, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'Monthly gross profit, volume and margin' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gross Profit', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top 10 accounts by gross profit' })).toBeVisible();
    await expect(page.getByText('Profit vs prior period')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /STEMs by (status|type)/i })).toHaveCount(0);
    if (await mobileFilters.isVisible()) await mobileFilters.click();
    await page.getByRole('button', { name: 'Prior year · Hidden', exact: true }).click();
    await expect(page.getByText('Prior-year gross margin %', { exact: true })).toBeVisible();

    if (await mobileFilters.isVisible()) await mobileFilters.click();
    const company = page.getByLabel('Company or GROUP');
    await company.fill('not a Salesforce account or group');
    await company.press('Enter');
    await expect(page.getByText('No Company or GROUP matches.')).toBeVisible();
    await company.press('Escape');
    if (await mobileFilters.isVisible()) await mobileFilters.click();

    await page.getByRole('tab', { name: 'STEMs', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search STEMs' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Columns/i })).toBeVisible();
    if (await page.locator('table').first().isVisible()) {
      await expect(page.getByRole('columnheader', { name: 'Supplier' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Product / extra cost · quantity' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /Delivery \/ expected date/i })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'P&L table', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Filtered STEMs P&L' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Accounts', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(page.getByText('Netting may conceal gross receivable and payable risk.')).toHaveCount(0);
    const statementButton = page.getByRole('button', { name: 'Statement', exact: true }).first();
    await expect(statementButton).toBeVisible();
    const directoryRequests = [];
    page.on('request', (request) => {
      if (/dashboardAccount(?:CreditDirectory|ExposureBatch)/.test(request.url())) directoryRequests.push(request.url());
    });
    const scrollTop = await page.locator('.app-workspace-scroll').evaluate((element) => element.scrollTop);
    await statementButton.click();
    await expect(page.getByRole('tab', { name: 'Credit Statement' })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText('Buyer receivable and supplier payable are reported separately by currency.')).toHaveCount(0);
    const sideToggle = page.getByLabel('Credit statement view');
    await expect(sideToggle).toBeVisible();
    for (const side of ['Both', 'Buyer', 'Supplier']) await expect(sideToggle.getByRole('button', { name: side, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(statementButton).toBeFocused();
    expect(await page.locator('.app-workspace-scroll').evaluate((element) => element.scrollTop)).toBe(scrollTop);
    expect(directoryRequests).toEqual([]);
    expect(failures).toEqual([]);
  });
});
