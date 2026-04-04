/**
 * vite.inject.config.ts
 *
 * Builds the bridge as a self-contained IIFE bundle for injection
 * into the Miris player tab via a <script> tag.
 *
 * Uses rollupOptions directly (not lib mode) to avoid extension/loader issues.
 * Output: public/bridge-dist/bridge.iife.js
 *
 * Usage:
 *   npm run build:inject    — one-off build (~6s)
 *   npm run watch:inject    — rebuild on file change
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: 'public/bridge-dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        name: 'MirisBabylonBridge',
        entryFileNames: 'bridge.iife.js',
        assetFileNames: '[name][extname]',
        inlineDynamicImports: true,
        // Polyfill process before any bundled code runs
        banner: 'var process = { env: { NODE_ENV: "production" } };',
      },
    },
  },
});
