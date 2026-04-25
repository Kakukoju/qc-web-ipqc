import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE || '/api'
  const appBase = env.VITE_APP_BASE || '/'

  return {
    base: appBase,
    plugins: [react(), tailwindcss()],
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
  }
})
