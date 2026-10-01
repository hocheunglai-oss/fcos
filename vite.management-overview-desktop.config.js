import { defineConfig } from 'vite';
import base from './vite.config.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  ...base,
  envDir: '/tmp/fcos-management-overview-desktop-empty-env',
  resolve: {
    alias: [
      { find: /^@\/api\/appClient$/, replacement: fileURLToPath(new URL('./e2e/fixtures/management-overview-desktop-client.js', import.meta.url)) },
      { find: /^@\/lib\/AuthContext$/, replacement: fileURLToPath(new URL('./e2e/fixtures/management-overview-desktop-auth.js', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'outputs/management-overview-desktop-fixture',
    rollupOptions: { input: 'e2e/fixtures/management-overview-desktop.html' },
  },
});
