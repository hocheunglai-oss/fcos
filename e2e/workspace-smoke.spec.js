import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const authenticatedWorkspaces = [
  ['/my-commitments', 'My Commitments'],
  ['/', 'Dashboard'],
  ['/account-managers', 'Account Managers'],
  ['/special-terms', 'Special Terms'],
  ['/payment-collections', 'Payment Collections'],
  ['/disputes', 'Dispute Workflow'],
  ['/unofficial-compensation', 'Unofficial Compensation'],
  ['/cashflow-forecast', 'Cashflow'],
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
      await expect(page.getByRole('heading', { name: title, exact: false }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Methodology' }).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      expect(failures).toEqual([]);
    });
  }
});
