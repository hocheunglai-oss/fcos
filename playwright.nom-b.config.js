import { defineConfig, devices } from '@playwright/test';
const port = 4196;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', testMatch: 'nom-b.spec.js', timeout: 30_000, expect: { timeout: 8_000 }, retries: 0, reporter: [['list']],
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: `npx vite --config vite.nom-b.config.js --host 127.0.0.1 --port ${port} --strictPort`, url: `${baseURL}/e2e/fixtures/nom-b.html`, reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
});
