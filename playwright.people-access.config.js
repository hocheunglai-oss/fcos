import { defineConfig } from '@playwright/test';
const port = 4197;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', testMatch: 'people-access.spec.js', workers: 1, timeout: 30_000, expect: { timeout: 8_000 }, retries: 0, reporter: [['list']],
  use: { baseURL, browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: `npx vite --config vite.people-access.config.js --host 127.0.0.1 --port ${port} --strictPort`, url: `${baseURL}/e2e/fixtures/people-access.html`, reuseExistingServer: false, timeout: 60_000 },
});
