import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { canonicalFcosE2eCandidateUrl, resolveFcosE2eCandidate } from './verify-e2e-candidate.mjs';
import { writePrivateE2eState } from './e2e-private-state.mjs';

// The bypass is exchanged outside browser tracing, with redirects disabled.
// Only its host-only cookie reaches the browser; no global HTTP headers can
// leak a project credential to FCUNO, Supabase, or third-party resources.
export function candidateProtectionState(state, candidateUrl, now = Date.now()) {
  const hostname = new URL(canonicalFcosE2eCandidateUrl(candidateUrl)).hostname;
  const cookies = state?.cookies;
  if (!Array.isArray(cookies) || cookies.length !== 1 || (state.origins || []).length) {
    throw new Error('Candidate protection must return exactly one host-only cookie.');
  }
  const cookie = cookies[0];
  if (cookie.name !== '_vercel_jwt' || cookie.domain !== hostname || cookie.path !== '/'
    || !cookie.secure || !cookie.httpOnly || cookie.sameSite !== 'Lax'
    || typeof cookie.value !== 'string' || !cookie.value
    || !Number.isFinite(cookie.expires) || cookie.expires <= now / 1000
    || cookie.expires > now / 1000 + 7 * 86400 + 60) {
    throw new Error('Candidate protection cookie scope or lifetime is invalid.');
  }
  return { cookies: [cookie], origins: [] };
}

export async function prepareCandidateProtection({
  env = process.env,
  request,
  verify = resolveFcosE2eCandidate,
  writeState = writePrivateE2eState,
} = {}) {
  const secret = env.FCOS_E2E_VERCEL_BYPASS;
  if (!secret) {
    if (env.FCOS_REQUIRE_AUTH_E2E === '1') throw new Error('Dedicated candidate protection access is required.');
    return;
  }
  const path = env.FCOS_E2E_PROTECTION_STATE;
  if (!path || !isAbsolute(path) || path === env.FCOS_E2E_STORAGE_STATE) {
    throw new Error('A separate absolute protection-state path is required.');
  }
  const candidateUrl = canonicalFcosE2eCandidateUrl(env.FCOS_E2E_BASE_URL);
  await verify({ candidateUrl, expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT, protectionBypass: secret, githubToken: env.GITHUB_TOKEN });
  const context = await request.newContext();
  try {
    const metadataUrl = `${candidateUrl}/app-version.json`;
    const response = await context.get(metadataUrl, {
      headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' },
      maxRedirects: 0,
      timeout: 20_000,
    });
    if (response.url() !== metadataUrl || response.status() !== 307
      || response.headers().location !== '/app-version.json') {
      throw new Error('Invalid protection bootstrap response.');
    }
    const state = candidateProtectionState(await context.storageState(), candidateUrl);
    await writeState({ env, path, state });
    return path;
  } catch {
    // Neither the response nor Playwright request errors are safe to log.
    throw new Error('Unable to establish host-scoped candidate protection. Check the dedicated CI credential.');
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup() {
  const { request } = await import('@playwright/test');
  const createdPath = await prepareCandidateProtection({ request });
  return async () => {
    if (createdPath) await rm(createdPath, { force: true });
  };
}
