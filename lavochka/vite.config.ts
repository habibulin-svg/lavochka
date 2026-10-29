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
  // без подсчёта gzip: на прод-сервере (2 ГБ) он добирал память до OOM-убийцы
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, reportCompressedSize: false },
  // модули three.js, которые грузятся лениво (3D-холдем): заранее, иначе Vite перезагружает страницу посреди партии
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/RGBELoader.js',
      'three/examples/jsm/libs/meshopt_decoder.module.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
    ],
  },
});
