/**
 * THE RECEIVER — BabylonReceiver.tsx
 *
 * A React component that:
 *  1. Renders a transparent <canvas> absolutely positioned over the Miris canvas.
 *  2. Initializes a BabylonJS Engine + Scene with a fixed ArcRotateCamera.
 *  3. Subscribes to geometryBus events.
 *  4. Pipes each GeometryChunk → Translator → Spawner.
 *  5. Exposes interceptCount and lastVertexCount for the debug HUD.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { onChunk } from '../tap/geometryTap';
import { translateChunk } from '../translator/toVertexData';
import { spawnMesh } from '../spawner/meshSpawner';

export interface ReceiverStats {
  interceptCount: number;
  lastVertexCount: number;
  falsified: boolean;
}

interface BabylonReceiverProps {
  onStats: (stats: ReceiverStats) => void;
}

export default function BabylonReceiver({ onStats }: BabylonReceiverProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef  = useRef<Scene | null>(null);
  const statsRef  = useRef<ReceiverStats>({ interceptCount: 0, lastVertexCount: 0, falsified: false });

  const updateStats = useCallback((patch: Partial<ReceiverStats>) => {
    statsRef.current = { ...statsRef.current, ...patch };
    onStats({ ...statsRef.current });
  }, [onStats]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // -----------------------------------------------------------------------
    // BabylonJS bootstrap
    // -----------------------------------------------------------------------
    const engine = new Engine(canvas, true, {
      alpha: true,           // transparent background so Miris shows through
      preserveDrawingBuffer: false,
      stencil: false,
    });
    engineRef.current = engine;

    const scene = new Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new Color4(0, 0, 0, 0); // fully transparent

    // Camera — static ArcRotate, user can orbit with mouse on overlay
    const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 4, 10, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.minZ = 0.01;

    // Lighting
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.4;

    const dir = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dir.intensity = 0.8;

    // Render loop
    engine.runRenderLoop(() => scene.render());

    // Resize handler
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // -----------------------------------------------------------------------
    // Subscribe to geometry bus
    // -----------------------------------------------------------------------
    const unsubscribe = onChunk((chunk) => {
      if (!sceneRef.current) return;

      const vertexData = translateChunk(chunk);
      spawnMesh(sceneRef.current, vertexData);

      const vertexCount = chunk.position ? chunk.position.length / 3 : 0;
      updateStats({
        interceptCount: statsRef.current.interceptCount + 1,
        lastVertexCount: vertexCount,
      });
    });

    // Falsification flag — set if watchdog fires and count is still 0 after 5.5s
    const falsificationTimer = setTimeout(() => {
      if (statsRef.current.interceptCount === 0) {
        updateStats({ falsified: true });
      }
    }, 5500);

    return () => {
      clearTimeout(falsificationTimer);
      unsubscribe();
      window.removeEventListener('resize', onResize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    };
  }, [updateStats]);

  return (
    <canvas
      ref={canvasRef}
      id="babylon-receiver-canvas"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none', // let clicks pass through to Miris
        zIndex: 9999,
        background: 'transparent',
      }}
    />
  );
}
