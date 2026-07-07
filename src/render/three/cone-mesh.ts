import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from "three";

import { Matrix } from "../../math/linalg/index.ts";
import type { LightCone } from "../../lightcone/index.ts";
import { timeUp, type SpacetimeEmbedding } from "./embedding.ts";

export type ConeColorMode = "solid" | "redshift";

export interface ConeMeshOptions {
  embedding?: SpacetimeEmbedding;
  // Solid surface color. Default the inspiration code's yellow.
  color?: number;
  // Initial color mode. Default "solid".
  colorMode?: ConeColorMode;
  // The redshift factor U mapped to the full "blueshift" color; larger values
  // desaturate the near-hole tint. Default 3.
  redshiftScale?: number;
}

// The light cone as a solid 3D mesh: the (θ, λ) grid triangulated in the
// spacetime embedding. Three grid subtleties are handled (plan §8):
//   • apex fan — the λ=0 row is one point, so the first band is triangles;
//   • seam — θ wraps, so the last ray closes back to the first;
//   • tearing — a face is emitted only where both bounding rays still have
//     valid samples, so where a wedge of rays fell into a hole the surface has
//     a notch reaching down to the worldtube.
// Vertex redshift colors (ω/E = √(−g^{tt})) are always computed; `setColorMode`
// toggles between the solid color and that map.
export class ConeMesh extends Mesh {
  private readonly mat: MeshStandardMaterial;
  private readonly solidColor: Color;

  constructor(cone: LightCone, options: ConeMeshOptions = {}) {
    const embedding = options.embedding ?? timeUp();
    const geometry = buildConeGeometry(cone, embedding, options.redshiftScale ?? 3);
    const solidColor = new Color(options.color ?? 0xf5c542);
    const mat = new MeshStandardMaterial({
      color: solidColor,
      side: DoubleSide,
      roughness: 0.35,
      metalness: 0.0,
      vertexColors: false,
    });
    super(geometry, mat);
    this.mat = mat;
    this.solidColor = solidColor;
    this.setColorMode(options.colorMode ?? "solid");
  }

  setColorMode(mode: ConeColorMode): void {
    if (mode === "redshift") {
      this.mat.vertexColors = true;
      this.mat.color.set(0xffffff); // let the vertex colors show
    } else {
      this.mat.vertexColors = false;
      this.mat.color.copy(this.solidColor);
    }
    this.mat.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}

function buildConeGeometry(
  cone: LightCone,
  embedding: SpacetimeEmbedding,
  redshiftScale: number,
): BufferGeometry {
  const nT = cone.rayCount;
  const nL = cone.sampleCount;
  const positions = new Float32Array(nT * nL * 3);
  const colors = new Float32Array(nT * nL * 3);

  const G = Matrix.square(cone.manifold.dimension);
  const timeIndex = cone.manifold.timeIndex;
  const event = cone.manifold.chart.create();
  const near = new Color(0x4aa8ff); // blueshift, deep in the well
  const far = new Color(0xffb03a); // redshift, far away
  const tmp = new Color();

  for (let i = 0; i < nT; i += 1) {
    for (let j = 0; j < nL; j += 1) {
      const vi = i * nL + j;
      const t = cone.coord(i, j, 0);
      const x = cone.coord(i, j, 1);
      const y = cone.coord(i, j, 2);
      embedding.embedInto(positions, vi * 3, t, x, y);

      // Static-observer frequency factor ω/E = √(−g^{tt}) (= U for MP).
      event.set(t, x, y);
      cone.manifold.metric.gInverseInto(G, event);
      const rf = Math.sqrt(Math.max(-G.get(timeIndex, timeIndex), 0));
      const s = Math.min(Math.max((rf - 1) / (redshiftScale - 1), 0), 1);
      tmp.copy(far).lerp(near, s);
      colors[vi * 3] = tmp.r;
      colors[vi * 3 + 1] = tmp.g;
      colors[vi * 3 + 2] = tmp.b;
    }
  }

  const rl = cone.rayLengths;
  const V = (i: number, j: number): number => i * nL + j;
  const idx: number[] = [];

  // Apex fan (λ = 0 → 1).
  for (let i = 0; i < nT; i += 1) {
    const iN = (i + 1) % nT;
    if (rl[i]! >= 2 && rl[iN]! >= 2) idx.push(V(i, 0), V(i, 1), V(iN, 1));
  }
  // Body quads (two triangles each), only where both rays are still valid.
  for (let j = 1; j < nL - 1; j += 1) {
    for (let i = 0; i < nT; i += 1) {
      const iN = (i + 1) % nT;
      if (rl[i]! > j + 1 && rl[iN]! > j + 1) {
        const a = V(i, j);
        const b = V(iN, j);
        const c = V(iN, j + 1);
        const d = V(i, j + 1);
        idx.push(a, b, d, b, c, d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
