import { expect, test as setup } from '@playwright/test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const email = String(process.env.FCOS_E2E_EMAIL || '').trim();
const password = String(process.env.FCOS_E2E_PASSWORD || '');
const fcunoIssuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
const candidateBaseUrl = String(process.env.FCOS_E2E_BASE_URL || '').trim();
const candidateOrigin = candidateBaseUrl ? new URL(candidateBaseUrl).origin : '';

async function reachFcunoSignIn(page) {
  await page.goto('/login');
  const continueWithFcuno = page.getByRole('button', { name: 'Continue with FCUNO', exact: true });
  await expect.poll(async () => {
    if (new URL(page.url()).origin === fcunoIssuer) return true;
    return continueWithFcuno.isVisible().catch(() => false);
  }, { timeout: 15_000 }).toBe(true);
  if (new URL(page.url()).origin !== fcunoIssuer) {
    await continueWithFcuno.click();
    await page.waitForURL((url) => url.origin === fcunoIssuer, { timeout: 15_000 });
  }
  expect(new URL(page.url()).origin).toBe(fcunoIssuer);
}

function assertFcunoAdminLocation(page) {
  const location = new URL(page.url());
  expect(location.origin).toBe(fcunoIssuer);
  expect(location.pathname).toBe('/admin');
}

setup('authenticate through the pinned FCUNO identity issuer', async ({ page }) => {
  if (!authState) throw new Error('FCOS_E2E_STORAGE_STATE is required.');
  if (!email || !password) throw new Error('FCOS_E2E_EMAIL and FCOS_E2E_PASSWORD are required for the renewable FCUNO test identity.');
  if (!candidateOrigin || candidateOrigin === 'https://fcos.fcuno.com') throw new Error('FCOS_E2E_BASE_URL must be the verified non-production candidate origin.');

  await reachFcunoSignIn(page);

  // FCUNO form contract: hocheunglai-oss/bunker-map@c5b58e4e2c6d41654fa0c63c4a740ebbbc454554
  // app/admin/page.tsx. Keep these provider-owned selectors behind the exact
  // FCUNO issuer and /admin checks; FCOS password authentication is retired.
  assertFcunoAdminLocation(page);
  await page.getByLabel('Username', { exact: true }).fill(email);
  assertFcunoAdminLocation(page);
  await page.getByLabel('Password', { exact: true }).fill(password);
  assertFcunoAdminLocation(page);
  await page.getByRole('button', { name: 'Login', exact: true }).click();

  await page.waitForURL((url) => url.origin === candidateOrigin, { timeout: 30_000 });
  expect(new URL(page.url()).origin).toBe(candidateOrigin);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: authState });
});
