import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: ['**/xero-exception.spec.js', '**/xero-manual.spec.js', '**/xero-contacts.spec.js'],
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5188', trace: 'off', screenshot: 'only-on-failure' },
  webServer: { command: `node node_modules/vite/bin/vite.js ${root} --config ${root}/vite.config.js --host 127.0.0.1 --port 5188 --strictPort`, cwd: root, url: 'http://127.0.0.1:5188/e2e/fixtures/xero-exception.html', reuseExistingServer: false, timeout: 30000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
});
