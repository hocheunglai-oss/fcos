import { defineConfig } from 'vite';
import base from './vite.config.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  ...base,
  envDir: '/tmp/fcos-missing-nom-b-empty-env',
  optimizeDeps: { entries: ['e2e/fixtures/missing-nom-b.html'] },
  resolve: { alias: [
    { find: /^@\/lib\/AuthContext$/, replacement: fileURLToPath(new URL('./e2e/fixtures/missing-nom-b-auth.js', import.meta.url)) },
    { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
  ] },
});
