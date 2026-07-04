import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      // Proxies to a detector_core process running separately in dev (see
      // frontend/README.md). In production, detector_core serves the built
      // frontend and the /ws route from the same origin - no proxy needed.
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
});
