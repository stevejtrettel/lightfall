import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
} from "three";

import type { LightCone } from "../../lightcone/index.ts";
import { timeUp, type SpacetimeEmbedding } from "./embedding.ts";

export interface ConeRaysOptions {
  embedding?: SpacetimeEmbedding;
  color?: number;
  opacity?: number;
  // Draw each ray only out to its first crossing of a centre's own radius (the
  // tube), matching the trimmed surface. Omit to draw the full traced strand,
  // including the plunge inside the tube.
  centers?: readonly { x: number; y: number; radius: number }[];
}

// The traced congruence as line segments: one polyline per emission angle, over
// the strand's valid samples. Overlaid on the surface it makes the angular
// sampling legible — rays bunch where the mesh is dense and fan apart where it
// is stretched thin (the whole point of the adaptive sampler is visible at a
// glance). Semi-transparent so overlap reads as density.
export class ConeRays extends LineSegments {
  private readonly mat: LineBasicMaterial;

  constructor(cone: LightCone, options: ConeRaysOptions = {}) {
    const embedding = options.embedding ?? timeUp();
    const geometry = buildRayGeometry(cone, embedding, options.centers);
    const mat = new LineBasicMaterial({
      color: options.color ?? 0x9fd0ff,
      transparent: true,
      opacity: options.opacity ?? 0.5,
      depthWrite: false,
    });
    super(geometry, mat);
    this.mat = mat;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}

// How many valid samples of ray `i` to draw: its whole valid length, or up to
// (and including a point on) the first crossing of a centre's own radius.
function drawableLength(
  cone: LightCone,
  i: number,
  centers: readonly { x: number; y: number; radius: number }[] | undefined,
): number {
  const len = cone.rayLengths[i]!;
  if (centers === undefined) return len;
  for (let j = 0; j < len; j += 1) {
    const x = cone.coord(i, j, 1);
    const y = cone.coord(i, j, 2);
    for (const c of centers) {
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy < c.radius * c.radius) return j + 1; // include the first inside point
    }
  }
  return len;
}

function buildRayGeometry(
  cone: LightCone,
  embedding: SpacetimeEmbedding,
  centers: readonly { x: number; y: number; radius: number }[] | undefined,
): BufferGeometry {
  // Two vertices per drawn segment; a ray of L drawn samples has L−1 segments.
  let segments = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    segments += Math.max(0, drawableLength(cone, i, centers) - 1);
  }
  const positions = new Float32Array(segments * 2 * 3);

  let o = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    const len = drawableLength(cone, i, centers);
    for (let j = 0; j < len - 1; j += 1) {
      embedding.embedInto(positions, o, cone.coord(i, j, 0), cone.coord(i, j, 1), cone.coord(i, j, 2));
      o += 3;
      embedding.embedInto(positions, o, cone.coord(i, j + 1, 0), cone.coord(i, j + 1, 1), cone.coord(i, j + 1, 2));
      o += 3;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
