/**
 * THE SPAWNER — meshSpawner.ts
 *
 * Creates a new BabylonJS Mesh from a VertexData object and applies a
 * bright wireframe material to visually differentiate it from the native
 * Miris render underneath.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

let meshCounter = 0;

// Shared wireframe material — created lazily per scene
const materialCache = new WeakMap<Scene, StandardMaterial>();

function getWireframeMaterial(scene: Scene): StandardMaterial {
  if (materialCache.has(scene)) return materialCache.get(scene)!;

  const mat = new StandardMaterial('miris_bridge_wire', scene);
  mat.wireframe = true;
  mat.emissiveColor = new Color3(0, 1, 1);   // Bright cyan — contrasts with Miris
  mat.disableLighting = true;
  materialCache.set(scene, mat);
  return mat;
}

export function spawnMesh(scene: Scene, vertexData: VertexData): Mesh {
  const name = `miris_chunk_${meshCounter++}`;
  const mesh = new Mesh(name, scene);

  vertexData.applyToMesh(mesh, false); // false = not updatable (saves GPU memory)
  mesh.material = getWireframeMaterial(scene);

  return mesh;
}
