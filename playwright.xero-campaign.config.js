import { defineConfig } from '@playwright/test';
const port = 4198;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({ testDir: './e2e', testMatch: 'xero-campaign.spec.js', workers: 1, timeout: 30000, expect: { timeout: 8000 }, retries: 0, reporter: [['list']], use: { baseURL, browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'only-on-failure', video: 'off' }, webServer: { command: `npx vite --config vite.xero-campaign.config.js --host 127.0.0.1 --port ${port} --strictPort`, url: `${baseURL}/e2e/fixtures/xero-campaign.html`, reuseExistingServer: false, timeout: 60000 } });
