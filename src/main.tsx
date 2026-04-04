/**
 * main.tsx — Entry point
 *
 * CRITICAL ORDER:
 *  1. installTap() runs SYNCHRONOUSLY before React renders.
 *     The WebGL tap patches HTMLCanvasElement.prototype.getContext so it must
 *     be in place before ANY canvas on the page calls getContext().
 *  2. React renders App, which mounts the BabylonReceiver overlay.
 *
 * No window.THREE dependency — the tap works at the raw WebGL level.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTap } from './tap/geometryTap';
import App from './App';
import './index.css';

// Step 1 — Install the WebGL tap (no THREE needed)
installTap();

// Step 2 — Mount React
const container = document.getElementById('root');
if (!container) throw new Error('[Bridge] #root element not found in DOM.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
