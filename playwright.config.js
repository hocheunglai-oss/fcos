import { defineConfig, devices } from '@playwright/test';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from './scripts/lib/release-environment.mjs';

const baseURL = process.env.FCOS_E2E_BASE_URL || 'http://127.0.0.1:5173';
const usesExternalServer = Boolean(process.env.FCOS_E2E_BASE_URL);
if (process.env.FCOS_REQUIRE_AUTH_E2E === '1') {
  const releaseEnvironment = assertReleaseBrowserEnvironment();
  await verifyReleasePreviewArtifact(releaseEnvironment);
}

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: usesExternalServer ? undefined : {
    command: 'npm run dev:full',
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    ...(process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD ? [{
      name: 'auth-setup',
      testMatch: /auth\.setup\.js/,
      use: { ...devices['Desktop Chrome'] },
    }] : []),
    {
      name: 'desktop-chrome',
      testIgnore: /auth\.setup\.js/,
      dependencies: process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD ? ['auth-setup'] : [],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      testIgnore: /auth\.setup\.js/,
      dependencies: process.env.FCOS_E2E_EMAIL && process.env.FCOS_E2E_PASSWORD ? ['auth-setup'] : [],
      use: { ...devices['Pixel 7'] },
    },
  ],
});
