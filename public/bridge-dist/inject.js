/**
 * inject.js — Miris Playground Injection Helper
 * ================================================
 * Paste into DevTools Console on the Miris player tab.
 * Type 'allow pasting' first, press Enter, then paste.
 *
 * Prerequisite: npm run dev is running at http://localhost:5173
 * (needed to serve the bridge-dist bundle via CORS-enabled static files)
 *
 * Or alternatively run: npm run build:inject
 * then serve public/ with any static server.
 */

(function injectMirisBabylonBridge() {
  // Inject #root mount point
  if (!document.getElementById('root')) {
    const root = document.createElement('div');
    root.id = 'root';
    root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;';
    document.body.appendChild(root);
  }

  // Inject the CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'http://localhost:5173/bridge-dist/style.css';
  document.head.appendChild(link);

  // Load the self-contained IIFE bundle — no preamble issues, no module deps
  const s = document.createElement('script');
  s.src = 'http://localhost:5173/bridge-dist/bridge.iife.js';
  s.onload = () => console.info('[Bridge] ✅ Tap v2 loaded! Watch for [Tap v2] lines.');
  s.onerror = (e) => console.error('[Bridge] ❌ Failed to load bundle:', e);
  document.head.appendChild(s);

  console.info('[Bridge] 🔍 Loading Miris-Babylon-Bridge IIFE bundle...');
})();
