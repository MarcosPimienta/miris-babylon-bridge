/**
 * content.js — Miris Babylon Bridge Chrome Extension
 * =====================================================
 * Injected into player.miris.com at document_start with world: "MAIN"
 * so it runs in the page's JavaScript context and can patch prototypes
 * BEFORE lockdown-install.js (SES) runs.
 */

(function () {
  const DEV = 'http://localhost:5173';
  const GEOMETRY_CHUNK_EVENT = 'geometry:chunk';

  // ── Shared geometry bus ─────────────────────────────────────────────────────
  const geometryBus = new EventTarget();
  window.__mirisBus = geometryBus;
  window.__mirisInstalled = true;

  // ── Per-context state ───────────────────────────────────────────────────────
  const GL_ARRAY_BUFFER = 0x8892;
  const GL_ELEMENT_ARRAY_BUFFER = 0x8893;
  const contextStates = new WeakMap();

  function getState(gl) {
    if (!contextStates.has(gl)) {
      contextStates.set(gl, {
        bufferStore: new WeakMap(),
        boundBuffer: new Map(),
        attribs: new Map(),
        enabledAttribs: new Set(),
      });
    }
    return contextStates.get(gl);
  }

  // ── Geometry chunk assembly ─────────────────────────────────────────────────
  let drawCallId = 0;
  let interceptCount = 0;

  function buildAndEmit(state, indexBuffer, indexType, vertexCount) {
    const rawVertexBuffers = [];
    const attribArrays = new Map();

    for (const idx of state.enabledAttribs) {
      const attrib = state.attribs.get(idx);
      if (!attrib || attrib.type !== 0x1406) continue; // GL_FLOAT only
      const raw = state.bufferStore.get(attrib.buffer);
      if (!raw) continue;
      const f32 = new Float32Array(raw);
      attribArrays.set(idx, f32);
      rawVertexBuffers.push(f32);
    }

    if (rawVertexBuffers.length === 0) return;

    let position = attribArrays.get(0);
    if (!position || state.attribs.get(0)?.size !== 3) {
      position = [...attribArrays.values()]
        .filter(f => f.length % 3 === 0)
        .sort((a, b) => b.length - a.length)[0];
    }
    if (!position) return;

    const normal = (state.attribs.get(1)?.size === 3) ? attribArrays.get(1) : undefined;
    const uv     = (state.attribs.get(2)?.size === 2) ? attribArrays.get(2) : undefined;

    let index;
    if (indexBuffer) {
      index = indexType === 0x1405
        ? new Uint32Array(indexBuffer.slice(0))
        : new Uint16Array(indexBuffer.slice(0));
    }

    const chunk = { id: `draw_${drawCallId++}`, position, normal, uv, index, rawVertexBuffers, vertexCount };
    interceptCount++;

    console.groupCollapsed(`[Bridge Ext] ✅ ${chunk.id} | ${vertexCount} verts | ${attribArrays.size} attribs`);
    console.log('  position items:', position.length);
    console.log('  normal   items:', normal?.length ?? '—');
    console.log('  index    items:', index?.length ?? '—');
    console.groupEnd();

    geometryBus.dispatchEvent(Object.assign(new Event(GEOMETRY_CHUNK_EVENT), { chunk }));
  }

  // ── WebGL context wrapper ───────────────────────────────────────────────────
  function wrapContext(gl) {
    if (gl.__miris_tapped__) return;
    gl.__miris_tapped__ = true;

    const proto = Object.getPrototypeOf(gl);
    const state = getState(gl);

    const _bindBuffer = proto.bindBuffer.bind(gl);
    gl.bindBuffer = function (target, buffer) {
      state.boundBuffer.set(target, buffer);
      return _bindBuffer(target, buffer);
    };

    const _bufferData = proto.bufferData.bind(gl);
    gl.bufferData = function (target, data, usage, ...rest) {
      const buf = state.boundBuffer.get(target);
      if (buf && data) {
        let ab;
        if (data instanceof ArrayBuffer) {
          ab = data;
        } else {
          ab = (data.buffer instanceof ArrayBuffer)
            ? data.buffer
            : new Uint8Array(data.buffer).buffer;
        }
        state.bufferStore.set(buf, ab);
      }
      return _bufferData(target, data, usage, ...rest);
    };

    const _vap = proto.vertexAttribPointer.bind(gl);
    gl.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
      const buf = state.boundBuffer.get(GL_ARRAY_BUFFER);
      if (buf) state.attribs.set(index, { buffer: buf, size, type, stride, offset });
      return _vap(index, size, type, normalized, stride, offset);
    };

    const _enable = proto.enableVertexAttribArray.bind(gl);
    gl.enableVertexAttribArray = function (index) {
      state.enabledAttribs.add(index);
      return _enable(index);
    };

    const _disable = proto.disableVertexAttribArray.bind(gl);
    gl.disableVertexAttribArray = function (index) {
      state.enabledAttribs.delete(index);
      return _disable(index);
    };

    const _drawElements = proto.drawElements.bind(gl);
    gl.drawElements = function (mode, count, type, offset) {
      const idxBuf = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
      const idxData = idxBuf ? (state.bufferStore.get(idxBuf) ?? null) : null;
      buildAndEmit(state, idxData, idxData ? type : null, count);
      return _drawElements(mode, count, type, offset);
    };

    const _drawArrays = proto.drawArrays.bind(gl);
    gl.drawArrays = function (mode, first, count) {
      buildAndEmit(state, null, null, count);
      return _drawArrays(mode, first, count);
    };

    console.info('[Bridge Ext] 🔌 WebGL context wrapped:', gl.constructor.name);
  }

  // ── Patch HTMLCanvasElement ─────────────────────────────────────────────────
  const _origCanvas = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const ctx = _origCanvas.call(this, type, ...args);
    if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
      wrapContext(ctx);
    }
    return ctx;
  };

  // ── Patch OffscreenCanvas ───────────────────────────────────────────────────
  if (typeof OffscreenCanvas !== 'undefined') {
    const _origOffscreen = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type, ...args) {
      const ctx = _origOffscreen.call(this, type, ...args);
      if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
        wrapContext(ctx);
      }
      return ctx;
    };
  }

  // ── Log Worker creation (diagnostic) ───────────────────────────────────────
  const _OrigWorker = window.Worker;
  if (_OrigWorker) {
    window.Worker = function (url, options) {
      console.info('[Bridge Ext] 🔌 Worker created:', String(url).substring(0, 80));
      return new _OrigWorker(url, options);
    };
    window.Worker.prototype = _OrigWorker.prototype;
  }

  console.info('[Bridge Ext] 🚀 document_start tap active — HTMLCanvasElement + OffscreenCanvas patched');

  // ── After load: inject bridge UI ───────────────────────────────────────────
  window.addEventListener('load', () => {
    // Watchdog
    setTimeout(() => {
      if (interceptCount === 0) {
        console.warn('[Bridge Ext] ⚠️ FALSIFICATION: 0 draw calls in 5s after load.');
      } else {
        console.info(`[Bridge Ext] 📊 ${interceptCount} draw calls captured so far.`);
      }
    }, 5000);

    // Mount bridge UI
    setTimeout(() => {
      if (!document.getElementById('root')) {
        const root = document.createElement('div');
        root.id = 'root';
        root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;';
        document.body.appendChild(root);
      }
      const s = document.createElement('script');
      s.src = DEV + '/bridge-dist/bridge.iife.js';
      s.onerror = () => console.error('[Bridge Ext] ❌ Bundle load failed — is npm run dev running at localhost:5173?');
      document.head.appendChild(s);
      console.info('[Bridge Ext] 💉 Bridge UI injected');
    }, 500);
  });

})();
