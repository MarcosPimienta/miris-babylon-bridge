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

const materialCache = new WeakMap<Scene, StandardMaterial>();

function getSolidMaterial(scene: Scene): StandardMaterial {
  if (materialCache.has(scene)) return materialCache.get(scene)!;

  const mat = new StandardMaterial('miris_bridge_solid', scene);
  mat.diffuseColor = new Color3(0, 0.5, 0.8); // Deep azure base
  mat.emissiveColor = new Color3(0.0, 0.2, 0.4); // Slight cyan glow
  mat.specularColor = new Color3(0, 1.0, 1.0); // Shiny cyan specular reflections
  mat.specularPower = 32;
  mat.ambientColor = new Color3(0.5, 0.5, 0.5);
  mat.alpha = 0.9;
  
  materialCache.set(scene, mat);
  return mat;
}

let meshCounter = 0;
export function spawnMesh(scene: Scene, vertexData: VertexData): Mesh {
  const name = `miris_chunk_${meshCounter++}`;
  const mesh = new Mesh(name, scene);

  vertexData.applyToMesh(mesh, false); // false = not updatable
  mesh.material = getSolidMaterial(scene);

  return mesh;
}
