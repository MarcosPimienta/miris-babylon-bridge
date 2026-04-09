/**
 * THE TAP v2 — WebGL-Level Interception
 * =======================================
 * Miris uses AquaApi.wasm → WebGL directly, bypassing Three.js entirely.
 * We patch HTMLCanvasElement.prototype.getContext to intercept every WebGL
 * context at creation time, then wrap its key methods:
 *
 *   bindBuffer        → track which WebGLBuffer is active on each target
 *   bufferData        → capture all ArrayBuffer uploads to GPU memory
 *   vertexAttribPointer → map attribute indices to their buffers + layout
 *   enableVertexAttribArray → track which attributes are active per draw
 *   drawElements / drawArrays → emit a GeometryChunk from current state
 *
 * This approach is fully engine-agnostic: works with Three.js, BabylonJS,
 * custom Wasm renderers, and anything else that ultimately speaks WebGL.
 */

// ─── Public event bus ────────────────────────────────────────────────────────

export interface GeometryChunk {
  /** Sequential draw-call ID */
  id: string;
  type?: string;
  position?: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  index?: Uint16Array | Uint32Array;
  /** Diagnostic: all float vertex buffers captured in this draw call */
  rawVertexBuffers: Float32Array[];
  vertexCount: number;
}

export const GEOMETRY_CHUNK_EVENT = 'geometry:chunk';

// Use the userscript's shared bus if it was installed at document-start,
// otherwise create our own. This lets the userscript's tap (which runs before
// SES lockdown) emit events that the BabylonJS receiver picks up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const geometryBus: EventTarget =
  (window as any).__mirisBus ?? (() => {
    const bus = new EventTarget();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__mirisBus = bus;
    return bus;
  })();

export function onChunk(handler: (chunk: GeometryChunk) => void): () => void {
const listener = (e: Event) => {
    const chunk = (e as Event & { chunk?: GeometryChunk }).chunk || (e as CustomEvent<GeometryChunk>).detail;
    if (chunk) handler(chunk);
  };
  geometryBus.addEventListener(GEOMETRY_CHUNK_EVENT, listener);
  return () => geometryBus.removeEventListener(GEOMETRY_CHUNK_EVENT, listener);
}

function emitChunk(chunk: GeometryChunk) {
  geometryBus.dispatchEvent(
    Object.assign(new Event(GEOMETRY_CHUNK_EVENT), { chunk })
  );
}

// ─── Per-context state ───────────────────────────────────────────────────────

const GL_ARRAY_BUFFER = 0x8892;
const GL_ELEMENT_ARRAY_BUFFER = 0x8893;

interface AttribState {
  buffer: WebGLBuffer;
  size: number;       // itemSize (1–4)
  type: GLenum;       // GL_FLOAT = 0x1406
  stride: number;
  offset: number;
}

interface CtxState {
  /** WebGLBuffer → captured ArrayBuffer data */
  bufferStore: WeakMap<WebGLBuffer, ArrayBuffer>;
  /** target (ARRAY_BUFFER / ELEMENT_ARRAY_BUFFER) → currently bound WebGLBuffer */
  boundBuffer: Map<GLenum, WebGLBuffer | null>;
  /** attribute index → buffer + layout */
  attribs: Map<number, AttribState>;
  /** which attribute indices are currently enabled */
  enabledAttribs: Set<number>;
}

const contextStates = new WeakMap<WebGLRenderingContext | WebGL2RenderingContext, CtxState>();

function getState(gl: WebGLRenderingContext | WebGL2RenderingContext): CtxState {
  if (!contextStates.has(gl)) {
    contextStates.set(gl, {
      bufferStore: new WeakMap(),
      boundBuffer: new Map(),
      attribs: new Map(),
      enabledAttribs: new Set(),
    });
  }
  return contextStates.get(gl)!;
}

// ─── Draw call → GeometryChunk assembly ─────────────────────────────────────

let drawCallId = 0;

/**
 * GL convention for Three.js / most renderers:
 *   attrib 0 → position  (size 3)
 *   attrib 1 → normal    (size 3)
 *   attrib 2 → uv        (size 2)
 *
 * Miris may differ, so we also fall back to heuristics if attrib 0 is missing.
 */
function buildChunk(
  state: CtxState,
  indexBuffer: ArrayBuffer | null,
  indexType: GLenum | null,
  vertexCount: number
): GeometryChunk | null {
  const id = `draw_${drawCallId++}`;
  const rawVertexBuffers: Float32Array[] = [];

  // Collect all currently-enabled attribute buffers as Float32Arrays
  const attribArrays = new Map<number, Float32Array>();
  for (const attribIdx of state.enabledAttribs) {
    const attrib = state.attribs.get(attribIdx);
    if (!attrib) continue;
    const raw = state.bufferStore.get(attrib.buffer);
    if (!raw) continue;
    // Only care about GL_FLOAT (0x1406) attributes for now
    if (attrib.type !== 0x1406) continue;
    const f32 = new Float32Array(raw);
    attribArrays.set(attribIdx, f32);
    rawVertexBuffers.push(f32);
  }

  if (rawVertexBuffers.length === 0) return null; // nothing float = not geometry

  // Heuristic: attrib 0 = position if size==3, else first 3-component float buffer
  let position: Float32Array | undefined;
  let normal: Float32Array | undefined;
  let uv: Float32Array | undefined;

  const pos0 = attribArrays.get(0);
  const norm1 = attribArrays.get(1);
  const uv2 = attribArrays.get(2);

  if (pos0 && state.attribs.get(0)?.size === 3) {
    position = pos0;
  } else {
    // Fall back: largest float buffer with element count divisible by 3
    position = [...attribArrays.values()]
      .filter(f => f.length % 3 === 0)
      .sort((a, b) => b.length - a.length)[0];
  }

  if (norm1 && state.attribs.get(1)?.size === 3) {
    normal = norm1;
  }
  if (uv2 && state.attribs.get(2)?.size === 2) {
    uv = uv2;
  }

  // Index buffer
  let index: Uint16Array | Uint32Array | undefined;
  if (indexBuffer) {
    index = indexType === 0x1405 // GL_UNSIGNED_INT
      ? new Uint32Array(indexBuffer.slice(0))
      : new Uint16Array(indexBuffer.slice(0));
  }

  if (!position) return null;

  const chunk: GeometryChunk = {
    id,
    position,
    normal,
    uv,
    index,
    rawVertexBuffers,
    vertexCount,
  };

  console.groupCollapsed(`[Tap v2] ✅ Draw call ${id} | ${vertexCount} verts | ${attribArrays.size} attribs`);
  console.log('  position items:', position.length);
  console.log('  normal items  :', normal?.length ?? '—');
  console.log('  index items   :', index?.length ?? '—');
  console.groupEnd();

  return chunk;
}

// ─── Context wrapper ─────────────────────────────────────────────────────────

function wrapContext(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  // Don't double-tap
  if ((gl as unknown as Record<string, unknown>).__miris_tapped__) return;
  (gl as unknown as Record<string, unknown>).__miris_tapped__ = true;

  const proto = Object.getPrototypeOf(gl);
  const state = getState(gl);

  // bindBuffer
  const _bindBuffer = proto.bindBuffer.bind(gl);
  gl.bindBuffer = function (target: GLenum, buffer: WebGLBuffer | null) {
    state.boundBuffer.set(target, buffer);
    return _bindBuffer(target, buffer);
  };

  // bufferData
  const _bufferData = proto.bufferData.bind(gl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gl as any).bufferData = function (
    target: GLenum,
    data: ArrayBuffer | ArrayBufferView | null,
    usage: GLenum,
    ...rest: unknown[]
  ) {
    const buf = state.boundBuffer.get(target);
    if (buf && data) {
      let ab: ArrayBuffer;
      if (data instanceof ArrayBuffer) {
        ab = data;
      } else {
        // ArrayBufferView.buffer may be SharedArrayBuffer — copy to plain ArrayBuffer
        const view = data as ArrayBufferView;
        ab = view.buffer instanceof ArrayBuffer
          ? view.buffer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : new Uint8Array(view.buffer as unknown as ArrayBuffer).buffer;
      }
      state.bufferStore.set(buf, ab);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_bufferData as any)(target, data, usage, ...rest);
  };

  // vertexAttribPointer
  const _vap = proto.vertexAttribPointer.bind(gl);
  gl.vertexAttribPointer = function (
    index: number,
    size: number,
    type: GLenum,
    normalized: boolean,
    stride: number,
    offset: number
  ) {
    const buf = state.boundBuffer.get(GL_ARRAY_BUFFER);
    if (buf) {
      state.attribs.set(index, { buffer: buf, size, type, stride, offset });
    }
    return _vap(index, size, type, normalized, stride, offset);
  };

  // enableVertexAttribArray
  const _enable = proto.enableVertexAttribArray.bind(gl);
  gl.enableVertexAttribArray = function (index: number) {
    state.enabledAttribs.add(index);
    return _enable(index);
  };

  // disableVertexAttribArray
  const _disable = proto.disableVertexAttribArray.bind(gl);
  gl.disableVertexAttribArray = function (index: number) {
    state.enabledAttribs.delete(index);
    return _disable(index);
  };

  // drawElements → has index buffer
  const _drawElements = proto.drawElements.bind(gl);
  gl.drawElements = function (mode: GLenum, count: number, type: GLenum, offset: number) {
    const idxBuf = state.boundBuffer.get(GL_ELEMENT_ARRAY_BUFFER);
    const idxData = idxBuf ? state.bufferStore.get(idxBuf) ?? null : null;
    const chunk = buildChunk(state, idxData, idxData ? type : null, count);
    if (chunk) emitChunk(chunk);
    return _drawElements(mode, count, type, offset);
  };

  // drawArrays → no index buffer
  const _drawArrays = proto.drawArrays.bind(gl);
  gl.drawArrays = function (mode: GLenum, first: number, count: number) {
    const chunk = buildChunk(state, null, null, count);
    if (chunk) emitChunk(chunk);
    return _drawArrays(mode, first, count);
  };

  console.info('[Tap v2] 🔌 WebGL context wrapped:', gl.constructor.name);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

let installed = false;
let interceptCount = 0;

/**
 * Scans the document (including shadow DOM roots) for canvases that already
 * have a live WebGL context — i.e. ones created before our getContext patch
 * was installed. Calling getContext() on an existing canvas returns the same
 * live context object, so we can wrap it retroactively.
 */
function bindExistingContexts(): void {
  const canvases: HTMLCanvasElement[] = [];

  // Main document
  canvases.push(...Array.from(document.querySelectorAll('canvas')));

  // Shadow DOM — walk every element
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const el = node as Element;
    if (el.shadowRoot) {
      canvases.push(...Array.from(el.shadowRoot.querySelectorAll('canvas')));
    }
    node = walker.nextNode();
  }

  if (canvases.length === 0) {
    console.info('[Tap v2] No existing canvases found (will catch on creation).');
    return;
  }

  console.info(`[Tap v2] Found ${canvases.length} existing canvas(es) — late-binding WebGL context(s)...`);

  for (const canvas of canvases) {
    // Try WebGL2 first, fall back to WebGL1
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (gl) {
      wrapContext(gl);
    }
  }
}

export function installTap(): void {
  // If the Tampermonkey userscript already installed the tap at document-start,
  // skip re-patching — the prototypes are already wrapped and the bus is shared.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__mirisInstalled) {
    console.info('[Tap v2] Userscript tap already active — bridge bundle connected to shared bus.');
    return;
  }

  if (installed) return;
  installed = true;

  // Track emitted chunks for the falsification watchdog
  geometryBus.addEventListener(GEOMETRY_CHUNK_EVENT, () => interceptCount++);

  // Late-bind to any context already alive when the tap is injected
  bindExistingContexts();

  // Patch getContext for any canvas created AFTER this point
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function (
    type: string,
    ...args: unknown[]
  ) {
    const ctx = originalGetContext.call(this, type, ...args);
    if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
      wrapContext(ctx as WebGLRenderingContext | WebGL2RenderingContext);
    }
    return ctx;
  };

  // Falsification watchdog — 5 seconds after install
  setTimeout(() => {
    if (interceptCount === 0) {
      console.warn(
        '[Tap v2] ⚠️  FALSIFICATION WARNING: Zero draw calls intercepted after 5s.\n' +
        '         Possible causes:\n' +
        '         1. Canvas is inside an <iframe> — run: document.querySelectorAll("iframe")\n' +
        '         2. Miris uses OffscreenCanvas in a Web Worker\n' +
        '         3. Model has not started streaming yet — wait and check again\n' +
        '         4. Tap was installed after the page session ended'
      );
    } else {
      console.info(`[Tap v2] 📊 Watchdog OK — ${interceptCount} draw calls captured.`);
    }
  }, 5000);

  console.info('[Tap v2] 🔌 Tap installed. Scanning for existing contexts + patching getContext...');
}
