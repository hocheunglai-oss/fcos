import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const requireAuthenticatedCoverage = process.env.FCOS_REQUIRE_AUTH_E2E === '1';
if (requireAuthenticatedCoverage && (!authState || !existsSync(authState))) {
  throw new Error('Authenticated FCOS browser coverage is required. Set FCOS_E2E_STORAGE_STATE to a signed-in test-user storage state.');
}
const authenticatedWorkspaces = [
  ['/my-commitments', 'My Commitments'],
  ['/growth-coaching', 'Growth & Coaching'],
  ['/projects-tasks', 'Projects & Tasks'],
  ['/fcos-improvements', 'FCOS Improvements'],
  ['/email-router', 'Email Router'],
  ['/', 'Dashboard'],
  ['/account-managers', 'Account Managers'],
  ['/markets', 'Markets'],
  ['/special-terms', 'Special Terms'],
  ['/payment-collections', 'Payment Collections'],
  ['/disputes', 'Dispute Workflow'],
  ['/unofficial-compensation', 'Unofficial Compensation'],
  ['/brokers', 'Broker'],
  ['/cashflow-forecast', 'Cashflow'],
  ['/review', 'Exception Review'],
  ['/pnl', 'Qlik Validator'],
  ['/hedge-desk', 'Hedge Desk'],
  ['/settings', 'Settings'],
];

test('login is usable without an application session', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Something went wrong');
  expect(failures).toEqual([]);
});

test.describe('authenticated read-only workspace matrix', () => {
  test.skip(!authState || !existsSync(authState), 'Set FCOS_E2E_STORAGE_STATE to a signed-in test-user storage state.');
  test.use({ storageState: authState });

  for (const [route, title] of authenticatedWorkspaces) {
    test(`${title} renders shared controls`, async ({ page }) => {
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Methodology' }).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      expect(failures).toEqual([]);
    });
  }
});
