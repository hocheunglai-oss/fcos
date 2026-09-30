import { defineConfig } from '@playwright/test';

const port = 4198;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  testMatch: 'missing-nom-b.spec.js',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL, browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: `npx vite --config vite.missing-nom-b.config.js --host 127.0.0.1 --port ${port} --strictPort`, url: `${baseURL}/e2e/fixtures/missing-nom-b.html`, reuseExistingServer: false, timeout: 60_000 },
});
