import { defineConfig } from 'vite';
import base from './vite.config.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  ...base, envDir: '/tmp/fcos-desktop-debug-empty-env',
  resolve: { alias: [
    { find: /^@\/api\/appClient$/, replacement: fileURLToPath(new URL('./e2e/fixtures/desktop-debug-client.js', import.meta.url)) },
    { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
  ] },
  build: { outDir: 'outputs/desktop-debug-fixture', rollupOptions: { input: 'e2e/fixtures/desktop-debug.html' } },
});
