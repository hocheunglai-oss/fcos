import { defineConfig } from 'vite';
import base from './vite.config.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  ...base,
  envDir: '/tmp/fcos-xero-integrity-empty-env',
  optimizeDeps: { entries: ['e2e/fixtures/xero-integrity.html'] },
  resolve: { alias: [
    { find: /^@\/api\/appClient$/, replacement: fileURLToPath(new URL('./e2e/fixtures/xero-integrity-client.js', import.meta.url)) },
    { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
  ] },
});
