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

export interface ConeTrim {
  // Cylinder centers in spatial (x, y) — the holes.
  centers: readonly { x: number; y: number }[];
  // The stop radius. The surface is cut cleanly on this circle around each
  // center (the worldtube). Requires rays traced slightly inside it.
  radius: number;
}

export interface ConeMeshOptions {
  embedding?: SpacetimeEmbedding;
  color?: number;
  colorMode?: ConeColorMode;
  redshiftScale?: number;
  // Trim the surface against the stop cylinders for a clean cut at the holes.
  trim?: ConeTrim;
  // Tear the surface where adjacent rays terminate at different lengths (leaves
  // the shadow as ragged holes). Defaults to false when a `trim` is set and true
  // otherwise: with a cylinder cut the grid must stay continuous so the cut is
  // the only near-hole boundary (terminated rays end deep inside the tube and
  // are clipped away) — tearing there instead shreds the surface into jagged
  // spikes right where it meets the tube. Untrimmed, tearing is what carves the
  // shadow, so it stays on.
  tear?: boolean;
}

// The light cone as a solid 3D mesh: the (θ, λ) grid triangulated in the
// spacetime embedding (apex fan, θ seam, tearing where rays terminated), then
// optionally trimmed against the stop cylinders so the surface cuts cleanly on
// the tube radius instead of ending in a ragged, grid-aligned tear.
export class ConeMesh extends Mesh {
  private readonly mat: MeshStandardMaterial;
  private readonly solidColor: Color;

  constructor(cone: LightCone, options: ConeMeshOptions = {}) {
    const embedding = options.embedding ?? timeUp();
    // A cut cylinder is the boundary; tearing near it would fight the cut, so
    // default tear off whenever a (non-empty) trim is present.
    const hasTrim = options.trim !== undefined && options.trim.centers.length > 0;
    const geometry = buildConeGeometry(
      cone,
      embedding,
      options.redshiftScale ?? 3,
      options.trim,
      options.tear ?? !hasTrim,
    );
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
      this.mat.color.set(0xffffff);
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

// A mesh vertex carried through clipping: world position, redshift colour, and
// smooth normal.
interface Vertex {
  p: [number, number, number];
  c: [number, number, number];
  n: [number, number, number];
}

function buildConeGeometry(
  cone: LightCone,
  embedding: SpacetimeEmbedding,
  redshiftScale: number,
  trim: ConeTrim | undefined,
  tear: boolean,
): BufferGeometry {
  const nT = cone.rayCount;
  const nL = cone.sampleCount;
  const positions = new Float32Array(nT * nL * 3);
  const colors = new Float32Array(nT * nL * 3);

  const G = Matrix.square(cone.manifold.dimension);
  const timeIndex = cone.manifold.timeIndex;
  const event = cone.manifold.chart.create();
  const near = new Color(0x4aa8ff);
  const far = new Color(0xffb03a);
  const tmp = new Color();

  for (let i = 0; i < nT; i += 1) {
    for (let j = 0; j < nL; j += 1) {
      const vi = i * nL + j;
      const t = cone.coord(i, j, 0);
      const x = cone.coord(i, j, 1);
      const y = cone.coord(i, j, 2);
      embedding.embedInto(positions, vi * 3, t, x, y);

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

  const index = buildConeIndex(cone, tear);

  // Smooth normals from the untrimmed grid; clipping interpolates them.
  const gridGeom = new BufferGeometry();
  gridGeom.setAttribute("position", new BufferAttribute(positions, 3));
  gridGeom.setIndex(new BufferAttribute(Uint32Array.from(index), 1));
  gridGeom.computeVertexNormals();
  const normals = gridGeom.getAttribute("normal").array as Float32Array;
  gridGeom.deleteAttribute("normal");
  gridGeom.dispose();

  const geometry = new BufferGeometry();
  if (!trim || trim.centers.length === 0) {
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals.slice(), 3));
    geometry.setIndex(new BufferAttribute(Uint32Array.from(index), 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  // Trim near-hole triangles against the stop cylinders; leave the rest indexed
  // on the original grid vertices.
  const R = trim.radius;
  const centers = trim.centers;
  const outIndex: number[] = [];
  const extraP: number[] = [];
  const extraC: number[] = [];
  const extraN: number[] = [];
  let nextVert = nT * nL;

  const readVertex = (vi: number): Vertex => ({
    p: [positions[vi * 3]!, positions[vi * 3 + 1]!, positions[vi * 3 + 2]!],
    c: [colors[vi * 3]!, colors[vi * 3 + 1]!, colors[vi * 3 + 2]!],
    n: [normals[vi * 3]!, normals[vi * 3 + 1]!, normals[vi * 3 + 2]!],
  });
  const appendVertex = (v: Vertex): number => {
    extraP.push(v.p[0], v.p[1], v.p[2]);
    extraC.push(v.c[0], v.c[1], v.c[2]);
    extraN.push(v.n[0], v.n[1], v.n[2]);
    return nextVert++;
  };
  // Does any center have a vertex of this triangle inside R? (Then it needs
  // clipping; otherwise it's fully outside and stays as-is.)
  const insideAny = (ia: number, ib: number, ic: number): boolean => {
    for (const ctr of centers) {
      for (const vi of [ia, ib, ic]) {
        const dx = positions[vi * 3]! - ctr.x;
        const dy = positions[vi * 3 + 2]! - ctr.y; // spatial y is world z
        if (dx * dx + dy * dy < R * R) return true;
      }
    }
    return false;
  };

  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t]!;
    const ib = index[t + 1]!;
    const ic = index[t + 2]!;
    if (!insideAny(ia, ib, ic)) {
      outIndex.push(ia, ib, ic);
      continue;
    }
    let tris: Vertex[][] = [[readVertex(ia), readVertex(ib), readVertex(ic)]];
    for (const ctr of centers) {
      const next: Vertex[][] = [];
      for (const tri of tris) clipTriangleOutsideDisk(tri, ctr.x, ctr.y, R, next);
      tris = next;
    }
    for (const tri of tris) {
      outIndex.push(appendVertex(tri[0]!), appendVertex(tri[1]!), appendVertex(tri[2]!));
    }
  }

  const finalP = concatFloat32(positions, extraP);
  const finalC = concatFloat32(colors, extraC);
  const finalN = concatFloat32(normals, extraN);
  geometry.setAttribute("position", new BufferAttribute(finalP, 3));
  geometry.setAttribute("color", new BufferAttribute(finalC, 3));
  geometry.setAttribute("normal", new BufferAttribute(finalN, 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(outIndex), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildConeIndex(cone: LightCone, tear: boolean): number[] {
  const nT = cone.rayCount;
  const nL = cone.sampleCount;
  const rl = cone.rayLengths;
  const V = (i: number, j: number): number => i * nL + j;
  const idx: number[] = [];
  for (let i = 0; i < nT; i += 1) {
    const iN = (i + 1) % nT;
    if (rl[i]! >= 2 && rl[iN]! >= 2) idx.push(V(i, 0), V(i, 1), V(iN, 1));
  }
  for (let j = 1; j < nL - 1; j += 1) {
    for (let i = 0; i < nT; i += 1) {
      const iN = (i + 1) % nT;
      // With tearing off, draw every quad — terminated rays are padded with
      // their last point, so the quads past termination collapse onto that
      // point (deep inside the tube) and are removed by the cylinder trim.
      if (!tear || (rl[i]! > j + 1 && rl[iN]! > j + 1)) {
        const a = V(i, j);
        const b = V(iN, j);
        const c = V(iN, j + 1);
        const d = V(i, j + 1);
        idx.push(a, b, d, b, c, d);
      }
    }
  }
  return idx;
}

// Clip a triangle against the OUTSIDE of a disk in the spatial (x, z) plane,
// keeping the part with distance ≥ R and adding vertices exactly on the circle
// where edges cross. Crossings interpolate position, colour, and normal
// linearly in the (approximated linear) distance. Appends result triangles.
function clipTriangleOutsideDisk(
  tri: Vertex[],
  cx: number,
  cy: number,
  R: number,
  out: Vertex[][],
): void {
  const dist = (v: Vertex): number => Math.hypot(v.p[0] - cx, v.p[2] - cy) - R;
  const d = [dist(tri[0]!), dist(tri[1]!), dist(tri[2]!)];
  if (d[0]! >= 0 && d[1]! >= 0 && d[2]! >= 0) {
    out.push(tri);
    return;
  }
  if (d[0]! < 0 && d[1]! < 0 && d[2]! < 0) return; // fully inside

  const poly: Vertex[] = [];
  for (let k = 0; k < 3; k += 1) {
    const a = tri[k]!;
    const b = tri[(k + 1) % 3]!;
    const da = d[k]!;
    const db = d[(k + 1) % 3]!;
    if (da >= 0) poly.push(a);
    if (da >= 0 !== db >= 0) {
      // Exact circle–edge crossing (distance is a hypot, not linear in t), so
      // the new vertex lands precisely on the stop circle.
      poly.push(lerpVertex(a, b, diskCrossing(a, b, cx, cy, R)));
    }
  }
  for (let k = 1; k < poly.length - 1; k += 1) {
    out.push([poly[0]!, poly[k]!, poly[k + 1]!]);
  }
}

// The parameter t ∈ [0, 1] where the segment a→b (in spatial x, z) meets the
// circle of radius R about (cx, cy): solve |a + t(b−a) − c|² = R².
function diskCrossing(a: Vertex, b: Vertex, cx: number, cy: number, R: number): number {
  const ex = a.p[0] - cx;
  const ez = a.p[2] - cy;
  const dx = b.p[0] - a.p[0];
  const dz = b.p[2] - a.p[2];
  const A = dx * dx + dz * dz;
  const B = 2 * (ex * dx + ez * dz);
  const C = ex * ex + ez * ez - R * R;
  if (A === 0) return 0;
  const disc = Math.max(B * B - 4 * A * C, 0);
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  const t2 = (-B + sq) / (2 * A);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return Math.min(Math.max(t1, 0), 1);
}

function lerpVertex(a: Vertex, b: Vertex, t: number): Vertex {
  const lerp3 = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
    u[0] + t * (v[0] - u[0]),
    u[1] + t * (v[1] - u[1]),
    u[2] + t * (v[2] - u[2]),
  ];
  const n = lerp3(a.n, b.n);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return { p: lerp3(a.p, b.p), c: lerp3(a.c, b.c), n: [n[0] / len, n[1] / len, n[2] / len] };
}

function concatFloat32(base: Float32Array, extra: number[]): Float32Array {
  if (extra.length === 0) return base.slice();
  const out = new Float32Array(base.length + extra.length);
  out.set(base, 0);
  out.set(extra, base.length);
  return out;
}
