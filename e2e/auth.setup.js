import { expect, test as setup } from '@playwright/test';
import { assertReleaseBrowserEnvironment, verifyReleaseBrowserPreview } from '../scripts/lib/release-environment.mjs';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const email = String(process.env.FCOS_E2E_EMAIL || '').trim();
const password = String(process.env.FCOS_E2E_PASSWORD || '');

setup('authenticate the dedicated FCOS CI viewer', async ({ page }) => {
  if (!authState) throw new Error('FCOS_E2E_STORAGE_STATE is required.');
  if (!email || !password) throw new Error('FCOS_E2E_EMAIL and FCOS_E2E_PASSWORD are required.');
  if (process.env.FCOS_REQUIRE_AUTH_E2E === '1') {
    // Keep this guard adjacent to credential use as a defense against a
    // Playwright invocation that bypasses the repository config file.
    await verifyReleaseBrowserPreview(assertReleaseBrowserEnvironment(), page.request);
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
  await page.context().storageState({ path: authState });
});
