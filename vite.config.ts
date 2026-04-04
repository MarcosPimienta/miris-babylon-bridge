import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow cross-origin requests so inject.js can load this from any origin
    cors: true,
    headers: {
      // Required for the overlay canvas to be rendered on a cross-origin page
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  // Tree-shake BabylonJS — only bundle what we import
  optimizeDeps: {
    include: ['@babylonjs/core'],
  },
});
