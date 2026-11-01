import { defineConfig, searchForWorkspaceRoot } from 'vite';

// Сервер (npm run dev:server) слушает 8787; в разработке Vite проксирует к нему WebSocket и API.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
    },
    // ГОПС в разработке берёт ассеты прямо с выхода конвейера (src/gops/assets.ts) — до отбора и раскладки в public/gops
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../docs/gops', 'G:/temp/studio/out/gops', 'G:/ai/out/studio/gops/music'] },
  },
  // без подсчёта gzip: на прод-сервере (2 ГБ) он добирал память до OOM-убийцы
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    reportCompressedSize: false,
    // ГОПС — отдельное полноэкранное приложение (docs/gops/CODE.md)
    rollupOptions: { input: { main: 'index.html', gops: 'gops.html' } },
  },
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
