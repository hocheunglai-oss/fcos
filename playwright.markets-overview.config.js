import { defineConfig, devices } from '@playwright/test';

const port = 4183;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'markets-overview.spec.js',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/e2e/fixtures/markets-overview.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
