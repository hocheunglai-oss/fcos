import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.FCOS_E2E_BASE_URL || 'http://127.0.0.1:5173';
const usesExternalServer = Boolean(process.env.FCOS_E2E_BASE_URL);

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
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
