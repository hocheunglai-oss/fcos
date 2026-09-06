import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const requireAuthenticatedCoverage = process.env.FCOS_REQUIRE_AUTH_E2E === '1';
const hasRenewableAuth = Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD);
const hasAuthenticatedCoverage = Boolean(authState) && (existsSync(authState) || hasRenewableAuth);
const fcunoIssuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
if (requireAuthenticatedCoverage && !hasAuthenticatedCoverage) {
  throw new Error('Authenticated FCOS browser coverage is required. Configure a storage-state file or the dedicated renewable FCUNO test credentials.');
}
const authenticatedWorkspaces = [
  ['/my-commitments', 'My Commitments'],
  ['/growth-coaching', 'Growth & Coaching'],
  ['/projects-tasks', 'Projects & Tasks'],
  ['/fcos-improvements', 'FCOS Improvements'],
  ['/', 'Dashboard'],
  ['/markets', 'Markets'],
  ['/special-terms', 'Special Terms'],
  ['/payment-collections', 'Payment Collections'],
  ['/disputes', 'Dispute Workflow'],
  ['/unofficial-compensation', 'Unofficial Compensation'],
  ['/brokers', 'Broker'],
  ['/cashflow-forecast', 'Cashflow'],
  ['/review', 'Exception Review'],
  ['/pnl', 'Qlik Validator'],
  ['/hedge-desk', 'Hedge Desk', 'Position control'],
  ['/settings', 'Settings'],
];

const mutatingOrMailboxWorkspaces = [
  ['/email-router', 'Email Router'],
  ['/account-managers', 'Account Managers'],
];

test('login delegates to the pinned FCUNO identity issuer', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
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
  expect(new URL(page.url()).pathname).toBe('/admin');
  expect(failures).toEqual([]);
});

test.describe('authenticated read-only workspace matrix', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable FCUNO test credentials.');
  test.use({ storageState: authState });

  for (const [route, title, heading = title] of authenticatedWorkspaces) {
    test(`${title} renders shared controls`, async ({ page }) => {
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      // Wait for the workspace header, not the always-visible sidebar label.
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Methodology' }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      expect(failures).toEqual([]);
    });
  }
});

test.describe('dedicated CI viewer cannot mutate guarded workspaces', () => {
  test.skip(!hasAuthenticatedCoverage, 'Configure a storage-state file or the dedicated renewable FCUNO test credentials.');
  test.use({ storageState: authState });

  for (const [route, title] of mutatingOrMailboxWorkspaces) {
    test(`${title} is denied`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByText('Access denied', { exact: false }).first()).toBeVisible();
    });
  }
});
