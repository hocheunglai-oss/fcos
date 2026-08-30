import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

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
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
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
