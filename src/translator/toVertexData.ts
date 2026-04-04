/**
 * THE TRANSLATOR — toVertexData.ts
 *
 * Pure function. No side effects. No BabylonJS scene dependency.
 * Converts a GeometryChunk (Three.js typed arrays) into a BABYLON.VertexData
 * object ready to be applied to a mesh.
 */

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { GeometryChunk } from '../tap/geometryTap';

/**
 * Translate a raw GeometryChunk into BabylonJS VertexData.
 *
 * Notes on coordinate systems:
 *  - Three.js uses a right-handed Y-up system.
 *  - BabylonJS uses a left-handed Y-up system.
 *  - To convert: negate the Z axis on positions and normals.
 *    This is toggled by `flipZ` (default: true).
 */
export function translateChunk(
  chunk: GeometryChunk,
  flipZ = true
): VertexData {
  const vd = new VertexData();

  if (chunk.position) {
    if (flipZ) {
      // Negate Z in-place on a copy — do NOT mutate the original intercepted array
      const positions = new Float32Array(chunk.position);
      for (let i = 2; i < positions.length; i += 3) {
        positions[i] = -positions[i];
      }
      vd.positions = positions;
    } else {
      vd.positions = chunk.position;
    }
  }

  if (chunk.normal) {
    if (flipZ) {
      const normals = new Float32Array(chunk.normal);
      for (let i = 2; i < normals.length; i += 3) {
        normals[i] = -normals[i];
      }
      vd.normals = normals;
    } else {
      vd.normals = chunk.normal;
    }
  }

  if (chunk.uv) {
    vd.uvs = chunk.uv;
  }

  if (chunk.index) {
    // BabylonJS wants indices in reverse winding order relative to Three.js
    // because of the handedness flip. Reverse each triangle's vertex order.
    const src = chunk.index;
    const indices = new Uint32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      indices[i]     = src[i];
      indices[i + 1] = src[i + 2]; // swap
      indices[i + 2] = src[i + 1]; // swap
    }
    vd.indices = indices;
  }

  return vd;
}
