import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  testDir: '.', testMatch: '**/xero-document-corrections.spec.js', reporter: [['list']], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5189', browserName: 'chromium', trace: 'off', screenshot: 'only-on-failure' },
  webServer: { command: `node node_modules/vite/bin/vite.js ${root} --config ${root}/vite.config.js --host 127.0.0.1 --port 5189 --strictPort`,
    cwd: root, url: 'http://127.0.0.1:5189/e2e/fixtures/xero-document-corrections.html', reuseExistingServer: true, timeout: 30000 },
});
