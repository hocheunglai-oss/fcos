import { defineConfig } from 'vite';
import base from './vite.config.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  ...base,
  envDir: '/tmp/fcos-people-access-empty-env',
  optimizeDeps: { entries: ['e2e/fixtures/people-access.html'] },
  resolve: { alias: [{ find: /^@\/lib\/AuthContext$/, replacement: fileURLToPath(new URL('./e2e/fixtures/people-access-auth.js', import.meta.url)) }, { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }] },
});
