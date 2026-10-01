import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'management-overview-desktop.spec.js',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4199',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node e2e/fixtures/management-overview-desktop-server.mjs',
    url: 'http://127.0.0.1:4199',
    reuseExistingServer: process.env.FCOS_MANAGEMENT_OVERVIEW_FIXTURE_RUNNING === '1',
    timeout: 60_000,
  },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } }],
});
