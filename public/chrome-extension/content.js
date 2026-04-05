/**
 * content.js -- Miris Babylon Bridge Chrome Extension v0.7
 * ARCHITECTURE CONFIRMED:
 *  - Workers 1-3: CPU/Wasm DECODE workers (action=decode, no WebGL)
 *  - Main thread: WebGL2 context renders the actual 3D geometry
 *  - FIX: wrap the main thread context with full geometry interceptors
 *  - FIX: intercept bufferSubData as well (streaming buffer updates)
 */
(function () {
  var DEV = 'http://localhost:5173';
  var GEOMETRY_CHUNK_EVENT = 'geometry:chunk';
  var WORKER_MSG_TYPE = '__miris_geometry_chunk__';
  var MAX_MAIN_CHUNKS = 200;

  var geometryBus = new EventTarget();
  window.__mirisBus = geometryBus;
  window.__mirisInstalled = true;

  // ---- WebGL interception shared constants ----
  var GL_ARRAY_BUFFER = 0x8892;
  var GL_ELEMENT_ARRAY_BUFFER = 0x8893;
  var GL_FLOAT = 0x1406;
  var GL_UNSIGNED_INT = 0x1405;
  var contextStates = new WeakMap();
  var mainChunkCount = 0;

  function getState(gl) {
    if (!contextStates.has(gl)) {
      contextStates.set(gl, {
        bufferStore: new WeakMap(),
        boundBuffer: new Map(),
        attribs: new Map(),
        enabledAttribs: new Set()
      });
    }
    return contextStates.get(gl);
  }

  function buildAndEmit(state, idxBuf, idxType, vertexCount) {
    if (mainChunkCount >= MAX_MAIN_CHUNKS) return;
    var attribArrays = new Map();
    for (var idx of state.enabledAttribs) {
      var attrib = state.attribs.get(idx);
      if (!attrib || attrib.type !== GL_FLOAT) continue;
      var raw = state.bufferStore.get(attrib.buffer);
      if (!raw) continue;
      attribArrays.set(idx, new Float32Array(raw.slice(0)));
    }
    if (attribArrays.size === 0) return;
    var position = attribArrays.get(0);
    if (!position || position.length < 9) {
      var candidates = [];
      attribArrays.forEach(function(v) { if (v.length % 3 === 0 && v.length >= 9) candidates.push(v); });
      candidates.sort(function(a, b) { return b.length - a.length; });
      position = candidates[0];
    }
    if (!position || position.length < 9) return;
    var a1 = state.attribs.get(1); var a2 = state.attribs.get(2);
    var normal = (a1 && a1.size === 3) ? attribArrays.get(1) : undefined;
    var uv = (a2 && a2.size === 2) ? attribArrays.get(2) : undefined;
    var index;
    if (idxBuf) {
      var ic = idxBuf.slice(0);
      index = idxType === GL_UNSIGNED_INT ? new Uint32Array(ic) : new Uint16Array(ic);
    }
    mainChunkCount++;
    var chunk = {
      id: 'main_draw_' + mainChunkCount,
      position: position, normal: normal, uv: uv, index: index,
      rawVertexBuffers: [position], vertexCount: vertexCount
    };
    console.info('[Main Tap] chunk ' + chunk.id + ' verts:' + vertexCount + ' attribs:' + attribArrays.size + ' pos:' + position.length);
    geometryBus.dispatchEvent(Object.assign(new Event(GEOMETRY_CHUNK_EVENT), { chunk: chunk }));
  }

  function wrapMainContext(gl) {
    if (gl.__miris_tapped__) return;
    gl.__miris_tapped__ = true;
    var proto = Object.getPrototypeOf(gl);
    var state = getState(gl);

    var _bind = proto.bindBuffer.bind(gl);
    gl.bindBuffer = function(target, buffer) {
      state.boundBuffer.set(target, buffer);
      return _bind(target, buffer);
    };

    // bufferData -- full buffer upload
    var _bd = proto.bufferData.bind(gl);
    gl.bufferData = function(target, data, usage) {
      var buf = state.boundBuffer.get(target);
      if (buf && data && typeof data !== 'number') {
        var ab;
        if (data instanceof ArrayBuffer) { ab = data.slice(0); }
        else if (data && data.buffer instanceof ArrayBuffer) { ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); }
        if (ab) state.bufferStore.set(buf, ab);
      }
      return _bd(target, data, usage);
    };

    // bufferSubData -- partial streaming update (KEY: Miris likely uses this)
    var _bsd = proto.bufferSubData.bind(gl);
    gl.bufferSubData = function(target, offset, data) {
      var buf = state.boundBuffer.get(target);
      if (buf && data && offset === 0) {
        // For offset=0 subData, treat as full replacement
        var ab;
        if (data instanceof ArrayBuffer) { ab = data.slice(0); }
        else if (data && data.buffer instanceof ArrayBuffer) { ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); }
        if (ab) state.bufferStore.set(buf, ab);
      }
      return _bsd(target, offset, data);
    };

    var _vap = proto.vertexAttribPointer.bind(gl);
    gl.vertexAttribPointer = function(i, sz, ty, n, st, of) {
      var buf = state.boundBuffer.get(GL_ARRAY_BUFFER);
      if (buf) state.attribs.set(i, { buffer: buf, size: sz, type: ty });
      return _vap(i, sz, ty, n, st, of);
    };

    var _en = proto.enableVertexAttribArray.bind(gl);
    gl.enableVertexAttribArray = function(i) { state.enabledAttribs.add(i); return _en(i); };
    var _dis = proto.disableVertexAttribArray.bind(gl);
    gl.disableVertexAttribArray = function(i) { state.enabledAttribs.delete(i); return _dis(i); };

    var _de = proto.drawElements.bind(gl);
    gl.drawElements = function(mode, count, type, offset) {
      var ib = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
      var id = ib ? (state.bufferStore.get(ib) || null) : null;
      buildAndEmit(state, id, id ? type : null, count);
      return _de(mode, count, type, offset);
    };

    var _da = proto.drawArrays.bind(gl);
    gl.drawArrays = function(mode, first, count) {
      buildAndEmit(state, null, null, count);
      return _da(mode, first, count);
    };

    // WebGL2 instanced and multi-draw variants
    if (proto.drawElementsInstanced) {
      var _dei = proto.drawElementsInstanced.bind(gl);
      gl.drawElementsInstanced = function(mode, count, type, offset, inst) {
        var ib = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
        var id = ib ? (state.bufferStore.get(ib) || null) : null;
        buildAndEmit(state, id, id ? type : null, count);
        return _dei(mode, count, type, offset, inst);
      };
    }
    if (proto.drawArraysInstanced) {
      var _dai = proto.drawArraysInstanced.bind(gl);
      gl.drawArraysInstanced = function(mode, first, count, inst) {
        buildAndEmit(state, null, null, count);
        return _dai(mode, first, count, inst);
      };
    }

    console.info('[Main Tap] WebGL2 context FULLY wrapped -- intercepting bufferData, bufferSubData, draw*');
  }

  // ---- Main-thread HTMLCanvasElement patch ----
  var _origCanvas = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var ctx = _origCanvas.apply(this, arguments);
    if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
      console.info('[Bridge Ext] Main-thread context intercepted -- applying full wrap');
      wrapMainContext(ctx);
    }
    return ctx;
  };

  // Also intercept transferControlToOffscreen just in case
  if (HTMLCanvasElement.prototype.transferControlToOffscreen) {
    var _origTransfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
    HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      var oc = _origTransfer.call(this);
      console.info('[Bridge Ext] transferControlToOffscreen called on canvas ' + this.width + 'x' + this.height);
      return oc;
    };
  }

  // ---- Block revocation of captured worker blob URLs ----
  var _capturedWorkerBlobs = new Set();
  var _origRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function (url) {
    if (_capturedWorkerBlobs.has(String(url))) {
      return; // keep alive for import()
    }
    return _origRevoke(url);
  };

  // ---- Worker TAP (kept for completeness, but workers are decode-only) ----
  var WORKER_TAP_LINES = [
    '(function() {',
    '  var WMSG = "PLACEHOLDER_MSG";',
    '  console.info("[Worker Tap] Worker started (decode-only worker -- no WebGL expected)");',
    '  var _nativeGetCtx = (typeof OffscreenCanvas !== "undefined") ? OffscreenCanvas.prototype.getContext : null;',
    '  if (_nativeGetCtx) {',
    '    OffscreenCanvas.prototype.getContext = function(type) {',
    '      console.info("[Worker Tap] OC.getContext called in worker:", type);',
    '      return _nativeGetCtx.apply(this, arguments);',
    '    };',
    '  }',
    '  var MSG_LOG_LIMIT = 2; var msgLogCount = 0;',
    '  self.addEventListener("message", function(e) {',
    '    var data = e.data; if (!data || typeof data !== "object") return;',
    '    if (msgLogCount < MSG_LOG_LIMIT) {',
    '      msgLogCount++;',
    '      console.info("[Worker Tap] action=" + data.action + " args-len=" + (Array.isArray(data.args) ? data.args.length : typeof data.args));',
    '    }',
    '  }, true);',
    '})();'
  ];
  var WORKER_TAP_CODE = WORKER_TAP_LINES.join('\n').replace('PLACEHOLDER_MSG', WORKER_MSG_TYPE);

  var workerIndex = 0;
  var _OrigWorker = window.Worker;
  window.Worker = function (url, options) {
    var urlStr = String(url);
    var wIdx = ++workerIndex;
    var isModule = options && options.type === 'module';
    console.info('[Bridge Ext] Worker #' + wIdx + ' (' + (isModule ? 'MODULE' : 'classic') + '):', urlStr.substring(0, 80));
    _capturedWorkerBlobs.add(urlStr);

    var wrapperCode = WORKER_TAP_CODE + '\n' +
      'try { await import(' + JSON.stringify(urlStr) + '); console.info("[Worker Tap] decode worker module loaded"); }\n' +
      'catch(e) { console.error("[Worker Tap] module load failed:", e && e.message); }\n';

    var wrappedBlob = new Blob([wrapperCode], { type: 'application/javascript' });
    var wrappedURL = URL.createObjectURL(wrappedBlob);
    return new _OrigWorker(wrappedURL, { type: 'module' });
  };
  window.Worker.prototype = _OrigWorker.prototype;

  console.info('[Bridge Ext] document_start tap active -- MAIN THREAD fully wrapped, decode workers monitored');

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!document.getElementById('root')) {
        var root = document.createElement('div');
        root.id = 'root';
        root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;';
        document.body.appendChild(root);
      }
      var s = document.createElement('script');
      s.src = DEV + '/bridge-dist/bridge.iife.js';
      s.onerror = function () { console.error('[Bridge Ext] Bundle load failed'); };
      document.head.appendChild(s);
      console.info('[Bridge Ext] Bridge UI injected');
    }, 500);
    setTimeout(function () {
      console.info('[Bridge Ext] Main-thread geometry chunks emitted so far: ' + mainChunkCount);
    }, 10000);
  });

})();
