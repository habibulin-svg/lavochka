import { defineConfig } from 'vite';

// Сервер (npm run dev:server) слушает 8787; в разработке Vite проксирует к нему WebSocket и API.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
