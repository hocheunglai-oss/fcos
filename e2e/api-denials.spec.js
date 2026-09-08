import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { assertCiApiDenials, CI_DENIAL_PROBES } from '../scripts/e2e-api-denials.mjs';
import { canonicalFcosE2eCandidateUrl } from '../scripts/verify-e2e-candidate.mjs';

const authState = process.env.FCOS_E2E_STORAGE_STATE || '';
const hasAuth = Boolean(authState) && (existsSync(authState)
  || Boolean(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD));
if (process.env.FCOS_REQUIRE_AUTH_E2E === '1' && !hasAuth) {
  throw new Error('Authenticated API-denial coverage is required.');
}

test.describe('deployed read-only CI API boundary', () => {
  test.skip(!hasAuth, 'The governed renewable CI identity is required.');
  test.use({ storageState: authState });

  test('direct and mixed-action requests are denied before business validation', async ({ page }) => {
    test.setTimeout(120_000);
    const origin = canonicalFcosE2eCandidateUrl(process.env.FCOS_E2E_BASE_URL);
    let started = false;
    let outcome;
    await page.route(`${origin}/api/functions/authContext`, async (route) => {
      if (started || route.request().method() !== 'POST') return route.continue();
      started = true;
      try {
        // Reuse the application's own authenticated request in memory. Do not
        // extract bearer tokens, inspect session storage, or set global headers.
        outcome = { results: await assertCiApiDenials({
          candidateUrl: origin, fetchProbe: (options) => route.fetch(options),
        }) };
      } catch (error) {
        outcome = { error: error.message }; // helper emits only a fixed safe label
      } finally {
        await route.continue();
      }
    });
    await page.goto('/');
    await expect.poll(() => Boolean(outcome), { timeout: 100_000 }).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.results).toEqual(CI_DENIAL_PROBES.map(({ path }) => ({ path, status: 403, code: 'FCOS_CI_READ_ONLY' })));
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  });
});
