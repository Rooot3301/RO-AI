import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement : /api et /auth sont relayés vers le serveur web local (voir deploy/).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:8081', '/auth': 'http://127.0.0.1:8081' } },
});
