import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE || '/api'
  const appBase = env.VITE_APP_BASE || '/'

  return {
    base: appBase,
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          'mobile-scan': resolve(__dirname, 'mobile-scan.html'),
          'rd-mobile': resolve(__dirname, 'rd-mobile.html'),
        },
      },
    },
    server: {
      proxy: {
        [apiBase]: {
          target: env.VITE_API_TARGET || 'http://localhost:3201',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(new RegExp(`^${apiBase}`), '/api'),
          proxyTimeout: 120000,
          timeout: 120000,
        },
      },
    },
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
      exclude: ['tests/**', 'node_modules/**', 'server/**', 'tutti-qc-assayprocess/**'],
    },
  }
})
