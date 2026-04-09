/**
 * content.js -- Miris Babylon Bridge Chrome Extension v3.0 Ultimate Native Tap
 * Hooks bufferData, bufferSubData, drawElements, drawArrays, AND instanced variants!
 */
(function() {
  var DEV = 'http://localhost:5173';
  var GEOMETRY_CHUNK_EVENT = 'geometry:chunk';

  // Shared bus setup
  var geometryBus = window.__mirisBus;
  if (!geometryBus) {
    geometryBus = new EventTarget();
    window.__mirisBus = geometryBus;
  }
  window.__mirisInstalled = true; // Tell optional geometryTap to sleep

  var GL_ARRAY_BUFFER = 0x8892;
  var GL_ELEMENT_ARRAY_BUFFER = 0x8893;
  var contextStates = new WeakMap();

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

  var drawCallId = 0;

  function buildAndEmit(state, indexBuffer, indexType, vertexCount) {
    var rawVertexBuffers = [];
    var attribArrays = new Map();

    for (var idx of state.enabledAttribs) {
      var attrib = state.attribs.get(idx);
      if (!attrib || attrib.type !== 0x1406) continue; // GL_FLOAT
      var raw = state.bufferStore.get(attrib.buffer);
      if (!raw) continue;
      var f32 = new Float32Array(raw);
      attribArrays.set(idx, f32);
      rawVertexBuffers.push(f32);
    }

    if (rawVertexBuffers.length === 0) return;

    var position = attribArrays.get(0);
    if (!position || state.attribs.get(0)?.size !== 3) {
      position = [...attribArrays.values()]
        .filter(f => f.length % 3 === 0)
        .sort((a, b) => b.length - a.length)[0];
    }
    if (!position) return;

    var normal = (state.attribs.get(1)?.size === 3) ? attribArrays.get(1) : undefined;
    var uv = (state.attribs.get(2)?.size === 2) ? attribArrays.get(2) : undefined;

    var indexArray;
    if (indexBuffer) {
      indexArray = (indexType === 0x1405)
        ? new Uint32Array(indexBuffer.slice(0))
        : new Uint16Array(indexBuffer.slice(0));
    }

    var chunk = {
      id: "raw_" + (drawCallId++),
      position: position,
      normal: normal,
      uv: uv,
      index: indexArray,
      rawVertexBuffers: rawVertexBuffers,
      vertexCount: vertexCount
    };

    console.log('[v3 Ultimate Tap] ✅ Chunk', chunk.id, '| verts:', vertexCount);
    geometryBus.dispatchEvent(Object.assign(new Event(GEOMETRY_CHUNK_EVENT), { chunk: chunk }));
  }

  function wrapContext(gl) {
    if (gl.__miris_tapped__) return;
    gl.__miris_tapped__ = true;
    console.info('[v3 Ultimate Tap] Wrapping context', gl);

    var proto = Object.getPrototypeOf(gl);
    var state = getState(gl);

    var _bindBuffer = proto.bindBuffer.bind(gl);
    gl.bindBuffer = function(target, buffer) {
      state.boundBuffer.set(target, buffer);
      return _bindBuffer(target, buffer);
    };

    function storeBufferData(target, data) {
      var buf = state.boundBuffer.get(target);
      if (buf && data) {
        var ab;
        if (data instanceof ArrayBuffer) ab = data.slice(0);
        else {
          var view = data;
          if (view.buffer instanceof ArrayBuffer) ab = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
          else ab = new Uint8Array(view.buffer).buffer; // SharedArrayBuffer fallback
        }
        if (ab) state.bufferStore.set(buf, ab);
      }
    }

    var _bufferData = proto.bufferData.bind(gl);
    gl.bufferData = function(target, data, usage) {
      storeBufferData(target, data);
      return _bufferData.apply(this, arguments);
    };

    var _bufferSubData = proto.bufferSubData.bind(gl);
    gl.bufferSubData = function(target, offset, data) {
      if (offset === 0) storeBufferData(target, data);
      return _bufferSubData.apply(this, arguments);
    };

    var _vap = proto.vertexAttribPointer.bind(gl);
    gl.vertexAttribPointer = function(index, size, type, normalized, stride, offset) {
      var buf = state.boundBuffer.get(GL_ARRAY_BUFFER);
      if (buf) state.attribs.set(index, { buffer: buf, size: size, type: type, stride: stride, offset: offset });
      return _vap.apply(this, arguments);
    };

    var _enable = proto.enableVertexAttribArray.bind(gl);
    gl.enableVertexAttribArray = function(index) {
      state.enabledAttribs.add(index);
      return _enable(index);
    };

    var _disable = proto.disableVertexAttribArray.bind(gl);
    gl.disableVertexAttribArray = function(index) {
      state.enabledAttribs.delete(index);
      return _disable(index);
    };

    var _drawElements = proto.drawElements.bind(gl);
    gl.drawElements = function(mode, count, type, offset) {
      var idxBuf = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
      var idxData = idxBuf ? (state.bufferStore.get(idxBuf) || null) : null;
      buildAndEmit(state, idxData, idxData ? type : null, count);
      return _drawElements(mode, count, type, offset);
    };

    var _drawArrays = proto.drawArrays.bind(gl);
    gl.drawArrays = function(mode, first, count) {
      buildAndEmit(state, null, null, count);
      return _drawArrays(mode, first, count);
    };

    if (proto.drawElementsInstanced) {
      var _dei = proto.drawElementsInstanced.bind(gl);
      gl.drawElementsInstanced = function(mode, count, type, offset, inst) {
        var idxBuf = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
        var idxData = idxBuf ? (state.bufferStore.get(idxBuf) || null) : null;
        buildAndEmit(state, idxData, idxData ? type : null, count);
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
  }

  var _origCanvas = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type) {
    var ctx = _origCanvas.apply(this, arguments);
    if (ctx && (type === 'webgl2' || type === 'webgl')) {
      if (this.closest && this.closest('#root')) return ctx;
      if (this.id === 'babylon-receiver-canvas') return ctx;
      if (this.width < 100 || this.height < 100) return ctx;
      wrapContext(ctx);
    }
    return ctx;
  };

  if (typeof OffscreenCanvas !== 'undefined') {
    var _origOffscreen = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function(type) {
      var ctx = _origOffscreen.apply(this, arguments);
      if (ctx && (type === 'webgl2' || type === 'webgl')) wrapContext(ctx);
      return ctx;
    };
  }

  // Blob Worker patch
  var _capturedWorkerBlobs = new Set();
  var _origRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function(url) { if (_capturedWorkerBlobs.has(String(url))) return; return _origRevoke(url); };

  var workerIndex = 0;
  var _OrigWorker = window.Worker;
  window.Worker = function(url, options) {
    var urlStr = String(url); 
    _capturedWorkerBlobs.add(urlStr);
    var code = 'try{await import('+JSON.stringify(urlStr)+');}catch(e){}\n';
    return new _OrigWorker(URL.createObjectURL(new Blob([code],{type:'application/javascript'})),{type:'module'});
  };
  window.Worker.prototype = _OrigWorker.prototype;

  // Inject BabylonJS Overlay
  var injectAttempts = 0;
  var injectTimer = setInterval(function() {
    if (document.body && document.head) {
      clearInterval(injectTimer);
      if (!document.getElementById('root')) {
        var root = document.createElement('div');
        root.id = 'root';
        root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;';
        document.body.appendChild(root);
      }
      var s = document.createElement('script');
      s.src = DEV + '/bridge-dist/bridge.iife.js';
      document.head.appendChild(s);
      console.info('[v3 Ultimate Tap] 💉 Injected Bridge Overlay bundle');
    } else if (injectAttempts++ > 50) {
      clearInterval(injectTimer);
    }
  }, 100);

})();
