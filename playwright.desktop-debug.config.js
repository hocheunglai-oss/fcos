import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'desktop-debug.spec.js', timeout: 30_000, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4198', trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: 'node e2e/fixtures/desktop-debug-server.mjs', url: 'http://127.0.0.1:4198', reuseExistingServer: process.env.FCOS_DESKTOP_FIXTURE_RUNNING === '1', timeout: 60_000 },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } }],
});
