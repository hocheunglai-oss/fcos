import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.FCOS_E2E_BASE_URL || 'http://127.0.0.1:5173';
const usesExternalServer = Boolean(process.env.FCOS_E2E_BASE_URL);

export default defineConfig({
  globalSetup: './scripts/e2e-protection-state.mjs',
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    // Authenticated traces contain bearer tokens and financial response bodies.
    trace: 'off',
    screenshot: 'only-on-failure',
    storageState: process.env.FCOS_E2E_PROTECTION_STATE || undefined,
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
      use: { ...devices['Desktop Chrome'], screenshot: 'off', video: 'off' },
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
