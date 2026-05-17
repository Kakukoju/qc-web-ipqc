import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/tutti-assayprocess/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api/assayprocess': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/assayprocess/, '/api'),
      },
    },
  },
});
