import { expect, test as setup } from '@playwright/test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { candidateAuthenticationState, writePrivateE2eState } from '../scripts/e2e-private-state.mjs';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const email = String(process.env.FCOS_E2E_EMAIL || '').trim().toLowerCase();
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

function assertReadOnlyCiAuthorization(result) {
  expect(result.status).toBe(200);
  const context = result.body || {};
  expect(context.user?.email).toBe(FCOS_READ_ONLY_CI.email);
  expect(context.user?.read_only_ci).toBe(true);
  expect(context.user?.user_type).toBe('viewer');
  expect(context.user?.active).toBe(true);
  const enabledModules = Object.entries(context.moduleAccess || {})
    .filter(([, allowed]) => allowed === true)
    .map(([module]) => module)
    .sort();
  expect(enabledModules).toEqual([...FCOS_READ_ONLY_CI.modules].sort());
  const capabilities = Object.values(context.capabilities || {});
  expect(capabilities.length).toBeGreaterThan(0);
  expect(capabilities.every((allowed) => allowed === false)).toBe(true);
}

setup('authenticate through the pinned FCUNO identity issuer', async ({ page }) => {
  if (!authState) throw new Error('FCOS_E2E_STORAGE_STATE is required.');
  if (!email || !password) throw new Error('FCOS_E2E_EMAIL and FCOS_E2E_PASSWORD are required for the renewable FCUNO test identity.');
  if (email !== FCOS_READ_ONLY_CI.email) throw new Error('Only the pinned read-only FCUNO identity may be used for CI.');
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
  // Observe the app's own bootstrap response, never inspect session storage or
  // extract a bearer token from the browser to make an additional request.
  const [authorizationResponse] = await Promise.all([
    page.waitForResponse((response) => response.url() === `${candidateOrigin}/api/functions/authContext`
      && response.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);

  await page.waitForURL((url) => url.origin === candidateOrigin, { timeout: 30_000 });
  expect(new URL(page.url()).origin).toBe(candidateOrigin);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  assertReadOnlyCiAuthorization({ status: authorizationResponse.status(), body: await authorizationResponse.json() });
  // Keep the FCUNO issuer session out of the persisted candidate state. The
  // state is collected in memory and written through the private no-overwrite
  // helper only after the callback reaches the verified candidate origin.
  const state = candidateAuthenticationState(await page.context().storageState(), candidateOrigin);
  await writePrivateE2eState({ path: authState, state });
});
