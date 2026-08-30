import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);

test.describe('Special Terms term-first workspace', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable test credentials.');
  test.use({ storageState: authState });

  test('shows the lightweight term list, dedicated editor, and paged Clause Library without browser errors', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/special-terms');
    await expect(page.getByText('Special Terms', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Special Terms/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Clause Library', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Search term or clause name')).toBeVisible();
    await expect(page.getByText('Advanced migration and history tools')).toBeVisible();

    const salesforceTermLink = page.locator('a[href*="salesforce.com/a0E"]').first();
    await expect(salesforceTermLink).toHaveAttribute('href', /salesforce\.com\/a0E/, { timeout: 30_000 });
    const salesforceHref = await salesforceTermLink.getAttribute('href');
    const termId = salesforceHref?.match(/\/([a-zA-Z0-9]{15,18})(?:\?|$)/)?.[1];
    expect(termId).toBeTruthy();

    await page.goto(`/special-terms/${termId}`);
    await expect(page.getByText('Complete Special Term update')).toBeVisible({ timeout: 30_000 });
    for (const section of ['Terms Text', 'Confirmation', 'Nomination', 'Matching Rules']) {
      await expect(page.getByRole('tab', { name: section, exact: true })).toBeVisible();
    }
    const previewTab = page.getByRole('tab', { name: 'Preview', exact: true });
    if (await previewTab.count()) {
      await expect(previewTab).toBeVisible();
      await previewTab.click();
      await expect(page.getByText('A4 document preview')).toBeVisible();
    } else {
      await page.getByRole('tab', { name: 'Terms Text', exact: true }).click();
      const emptyLegacyTerms = page.getByText('No Terms Text', { exact: true });
      if (await emptyLegacyTerms.count()) await expect(emptyLegacyTerms).toBeVisible();
      else await expect(page.getByRole('button', { name: 'Add clause', exact: true }).last()).toBeVisible();
    }

    await page.goto('/special-terms');
    await page.getByRole('tab', { name: 'Clause Library', exact: true }).click();
    await expect(page.getByPlaceholder('Search name or wording')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/matching clauses · filters are saved on this device/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /next/i })).toBeVisible();
    expect(failures).toEqual([]);
  });
});
