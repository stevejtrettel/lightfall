import { CylinderGeometry, Mesh, MeshStandardMaterial } from "three";
import { timeUp, type SpacetimeEmbedding } from "./embedding.ts";

export interface WorldtubeOptions {
  embedding?: SpacetimeEmbedding;
  tMin?: number; // default 0
  tMax: number;
  radius?: number; // default 0.3
  color?: number;
}

// A black hole is fixed in space for all time, so its history is a vertical
// pillar in the (x, y, t) block — the horizon worldtube. The cone's rays wrap
// around it and get absorbed into it (the tearing in ConeMesh).
export function worldtube(
  hole: { x: number; y: number },
  options: WorldtubeOptions,
): Mesh {
  const embedding = options.embedding ?? timeUp();
  const tMin = options.tMin ?? 0;
  const tMax = options.tMax;
  const radius = options.radius ?? 0.3;
  const ts = embedding.timeScale;

  const height = Math.max((tMax - tMin) * ts, 1e-3);
  const geometry = new CylinderGeometry(radius, radius, height, 32, 1, false);
  const material = new MeshStandardMaterial({
    color: options.color ?? 0x050505,
    emissive: 0xff6a00,
    emissiveIntensity: 0.25,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new Mesh(geometry, material);
  // Cylinder axis is +Y (= time in the default embedding); center it.
  mesh.position.set(hole.x, ((tMin + tMax) / 2) * ts, hole.y);
  return mesh;
}
