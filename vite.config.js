import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveAuthRuntimePolicy } from './shared/authRuntimePolicy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'warn',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    {
      name: 'fcos-public-supabase-config',
      configResolved({ env, command }) {
        const development = command === 'serve' && env.DEV === true;
        for (const publicKey of [env.VITE_SUPABASE_ANON_KEY, env.VITE_SUPABASE_PUBLISHABLE_KEY]) {
          if (publicKey && !resolveAuthRuntimePolicy({
            url: env.VITE_SUPABASE_URL,
            publicKey,
            development,
            hostname: development ? 'localhost' : '',
          }).configured) {
            throw new Error('Invalid FCOS browser configuration. Use an approved Supabase URL and a public client key.');
          }
        }
      },
    },
  ],
  build: {
    manifest: true,
    target: 'es2022',
    // Use the existing ES2022 target for equivalent smaller output, without unsafe transforms.
    minify: 'terser',
    terserOptions: { ecma: 2022, compress: { passes: 3 } },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shared quota formatting must not pull the lazy credit retry back into the campaign.
          if (id.endsWith('/src/lib/xeroCampaignQuota.js')) return 'xero-campaign-quota';
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router') || id.includes('/scheduler/')) return 'react-platform';
          if (id.includes('/@supabase/') || id.includes('/@tanstack/react-query/')) return 'data-platform';
          if (id.includes('/@radix-ui/') || id.includes('/cmdk/') || id.includes('/vaul/')) return 'ui-primitives';
          if (id.includes('/lucide-react/')) return 'workspace-icons';
          if (id.includes('/date-fns/')) return 'date-utils';
          return undefined;
        },
      },
    },
  },
});
