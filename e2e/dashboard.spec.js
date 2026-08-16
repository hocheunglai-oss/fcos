import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);

test.describe('Fast, currency-safe decision dashboard', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable test credentials.');
  test.use({ storageState: authState });

  test('keeps exact filters and all three decision views responsive without browser errors', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto('/');
    const dashboardHeading = page.getByRole('heading', { name: 'Fast, Currency-Safe Decision Dashboard' });
    test.skip(!(await dashboardHeading.isVisible({ timeout: 3_000 })), 'The feature branch is tested against production before promotion; verify this flow after the new dashboard is deployed.');
    await expect(dashboardHeading).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('tab', { name: 'STEMs', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dashboard filters' })).toBeVisible();

    const company = page.getByLabel('Exact company');
    await company.fill('not an exact Salesforce account');
    await company.press('Enter');
    await expect(page.getByText('Select an exact Salesforce option.')).toBeVisible();

    await page.getByRole('tab', { name: 'STEMs', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search STEMs' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Columns/i })).toBeVisible();

    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Accounts', exact: true })).toHaveAttribute('data-state', 'active');
    expect(failures).toEqual([]);
  });
});
