import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  TubeGeometry,
  Vector3,
} from "three";

// A smooth tube lofted along the *outer rim* of the (trimmed) light-cone
// surface: the far, escaping edge where the cone opens out. Where the surface
// dives into a black-hole worldtube it is cut against the cylinder — we do NOT
// trace the tube around that cut. Instead the rim breaks into arcs, and each arc
// tucks its end just inside the cylinder so the cone reads as plunging cleanly
// into the hole rather than being hemmed by a rim.
//
// The free boundary of the trimmed surface is extracted from the mesh (edges in
// exactly one triangle) after welding coincident vertices — welding folds the
// apex fan back into the interior, leaving only real boundaries. Each boundary
// edge is then classified: a "cut" edge lies on a stop circle (both ends at the
// cut radius around a hole); everything else is "rim". Only rim edges are tubed.

export interface EndTubeCut {
  // Cylinder centres in the spatial plane, each with its own cut radius (the
  // worldtube — radius scales with hole mass).
  centers: readonly { x: number; y: number; radius: number }[];
  // Where an arc ends against a cylinder, tuck its tip to this fraction of that
  // cylinder's radius (< 1 ⇒ just inside the opaque cylinder). Default 0.8.
  insideFactor?: number;
}

export interface EndTubeOptions {
  // Tube radius in world units.
  radius?: number;
  // Cross-section resolution.
  radialSegments?: number;
  // Positions within this distance are treated as the same boundary vertex.
  weldTolerance?: number;
  // Drop boundary arcs with fewer points than this.
  minLoopPoints?: number;
  // Override the inherited surface colour with a single solid colour.
  color?: number;
  // Tube segments per resampled control point (render resolution along length).
  smoothing?: number;
  // Even arc-length spacing (world units) the rim is resampled to before
  // lofting, so the curve is smooth regardless of the raw boundary's uneven,
  // jittery mesh spacing. Defaults to radius × 3.
  sampleSpacing?: number;
  // Extra Laplacian passes over the resampled rim, mainly to round genuine
  // lensing cusps (the centripetal curve already handles jitter). Endpoints of
  // open arcs stay pinned. Default 1.
  smoothPasses?: number;
  // Drop the cylinder-cut portions of the boundary and tuck arc ends inside the
  // holes. Omit to tube every boundary loop whole.
  cut?: EndTubeCut;
  // Multiply the tube's inherited colour by this factor (in linear space) so the
  // rim reads a touch darker than the surface it borders — a subtle outline.
  // Default 1 (inherit the surface colour exactly).
  darken?: number;
}

const DEFAULTS = {
  radius: 0.06,
  radialSegments: 16,
  weldTolerance: 1e-4,
  minLoopPoints: 6,
  smoothing: 2,
  smoothPasses: 1,
  insideFactor: 0.8,
  darken: 1,
};

const MIN_STATIONS = 8;
const MAX_STATIONS = 4000;

// The tube(s) tracing the rim of `surface`. Reads the surface's `position` and
// (optional) `color` attributes; the tube inherits the surface colour along the
// rim unless `color` is given.
export class EndTube extends Group {
  private readonly mat: MeshPhysicalMaterial;

  constructor(surface: BufferGeometry, options: EndTubeOptions = {}) {
    super();
    const opts = { ...DEFAULTS, ...options };
    const solid = options.color !== undefined ? new Color(options.color) : null;
    // A solid override is darkened directly; vertex-colour tubes are darkened
    // per-vertex in tubeAlong so the whole rim tracks the surface a touch darker.
    if (solid) solid.multiplyScalar(opts.darken);
    // Glossy clearcoat, matching the reference edge tube.
    this.mat = new MeshPhysicalMaterial({
      color: solid ?? 0xffffff,
      vertexColors: solid === null,
      side: DoubleSide,
      roughness: 0.05,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });

    const arcs = rimArcs(surface, opts);
    for (const arc of arcs) {
      const geom = tubeAlong(arc, opts.radius, opts.radialSegments, opts.smoothing, opts.darken);
      this.add(new Mesh(geom, this.mat));
    }
  }

  dispose(): void {
    for (const child of this.children) {
      if (child instanceof Mesh) child.geometry.dispose();
    }
    this.mat.dispose();
  }
}

interface Arc {
  points: Vector3[];
  colors: Color[];
  closed: boolean;
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

// Welded boundary vertices and the boundary edges of a trimmed surface.
interface Boundary {
  pos: Vector3[];
  col: Color[];
  edges: [number, number][];
}

function extractBoundary(surface: BufferGeometry, tol: number): Boundary {
  const pos = surface.getAttribute("position");
  const col = surface.getAttribute("color");
  const index = surface.getIndex();
  if (!pos || !index) return { pos: [], col: [], edges: [] };

  // Weld coincident vertices with a numeric spatial hash (no per-vertex string
  // allocation — this runs over every triangle corner of a large mesh).
  const q = 1 / Math.max(tol, 1e-9);
  const buckets = new Map<number, number[]>();
  const wPos: Vector3[] = [];
  const wCol: Color[] = [];
  const wqx: number[] = [];
  const wqy: number[] = [];
  const wqz: number[] = [];
  const origToWeld = new Int32Array(pos.count).fill(-1);
  const idOf = (i: number): number => {
    const cached = origToWeld[i]!;
    if (cached >= 0) return cached;
    const qx = Math.round(pos.getX(i) * q);
    const qy = Math.round(pos.getY(i) * q);
    const qz = Math.round(pos.getZ(i) * q);
    const h = (qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791);
    let bucket = buckets.get(h);
    if (bucket) {
      for (const w of bucket) {
        if (wqx[w] === qx && wqy[w] === qy && wqz[w] === qz) {
          origToWeld[i] = w;
          return w;
        }
      }
    } else {
      bucket = [];
      buckets.set(h, bucket);
    }
    const w = wPos.length;
    bucket.push(w);
    wqx.push(qx); wqy.push(qy); wqz.push(qz);
    wPos.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    wCol.push(col ? new Color(col.getX(i), col.getY(i), col.getZ(i)) : new Color(0xffffff));
    origToWeld[i] = w;
    return w;
  };

  // Count undirected edges over welded ids with a numeric key (a·N + b, exact
  // for N up to ~3M): boundary edges appear exactly once.
  const idx = index.array;
  // First pass welds so N (welded count) is known for the packed edge key.
  const tri = new Int32Array(idx.length);
  for (let t = 0; t < idx.length; t += 1) tri[t] = idOf(idx[t]!);
  const N = wPos.length;
  const count = new Map<number, number>();
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]!;
    const b = tri[t + 1]!;
    const c = tri[t + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      if (u === v) continue; // degenerate after welding
      const key = u < v ? u * N + v : v * N + u;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }

  const edges: [number, number][] = [];
  for (const [key, n] of count) {
    if (n !== 1) continue;
    edges.push([Math.floor(key / N), key % N]);
  }
  return { pos: wPos, col: wCol, edges };
}

// Adjacency over a set of edges.
function adjacency(edges: [number, number][]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number): void => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  return adj;
}

// Walk an adjacency graph into paths: open arcs first (from degree-1 ends and
// junctions), then any remaining pure cycles.
function walkPaths(adj: Map<number, number[]>): { seq: number[]; closed: boolean }[] {
  const used = new Set<string>();
  const paths: { seq: number[]; closed: boolean }[] = [];

  const walk = (start: number, first: number): { seq: number[]; closed: boolean } => {
    const seq = [start];
    let prev = start;
    let cur = first;
    used.add(edgeKey(start, first));
    while (true) {
      seq.push(cur);
      if (cur === start) return { seq: seq.slice(0, -1), closed: true };
      const nbrs = adj.get(cur) ?? [];
      let next = nbrs.find((n) => n !== prev && !used.has(edgeKey(cur, n)));
      if (next === undefined) next = nbrs.find((n) => !used.has(edgeKey(cur, n)));
      if (next === undefined) return { seq, closed: false };
      used.add(edgeKey(cur, next));
      prev = cur;
      cur = next;
    }
  };

  const startAll = (predicate: (degree: number) => boolean): void => {
    for (const [v, ns] of adj) {
      if (!predicate(ns.length)) continue;
      let first: number | undefined;
      while ((first = ns.find((n) => !used.has(edgeKey(v, n)))) !== undefined) {
        paths.push(walk(v, first));
      }
    }
  };

  startAll((d) => d === 1); // open ends
  startAll((d) => d > 2); // junctions
  startAll(() => true); // leftover cycles
  return paths;
}

// A spatial-plane distance from a world point to a hole centre (world z ≡ spatial y).
function spatialDist(p: Vector3, c: { x: number; y: number }): number {
  return Math.hypot(p.x - c.x, p.z - c.y);
}

// The boundary rim of the surface, as tube-ready arcs. With `cut`, the cylinder
// cuts are dropped and open arcs get their ends tucked just inside the holes.
function rimArcs(surface: BufferGeometry, opts: typeof DEFAULTS & EndTubeOptions): Arc[] {
  const { pos, col, edges } = extractBoundary(surface, opts.weldTolerance);
  if (edges.length === 0) return [];

  const cut = opts.cut;
  // On a cut circle: within a tolerance band of some hole's own cut radius.
  const onCut = (v: number): boolean => {
    if (!cut) return false;
    for (const c of cut.centers) {
      if (Math.abs(spatialDist(pos[v]!, c) - c.radius) < c.radius * 0.25) return true;
    }
    return false;
  };
  const isCutEdge = (a: number, b: number): boolean => cut !== undefined && onCut(a) && onCut(b);

  const rimEdges = cut ? edges.filter(([a, b]) => !isCutEdge(a, b)) : edges;
  const paths = walkPaths(adjacency(rimEdges));

  // Tuck an open arc's endpoint just inside the nearest cylinder. Rather than
  // yanking the tip straight in along the radius (which corners the curve where
  // it meets the cut, so the spline hooks and the tube bunches), continue the
  // arc along its own incoming tangent until it first crosses the inner circle
  // |·−c| = insideFactor·R — the last real segment and the dive are then
  // colinear and the tube slides in smoothly. Falls back to a radial tuck when
  // the arc ends too steeply (little in-plane tangent) or heads outward.
  const tuck = (v: number, nbr: number): Vector3 | null => {
    if (!cut) return null;
    let best: { c: { x: number; y: number; radius: number }; d: number } | null = null;
    for (const c of cut.centers) {
      const d = spatialDist(pos[v]!, c);
      if (!best || d < best.d) best = { c, d };
    }
    if (!best || Math.abs(best.d - best.c.radius) >= best.c.radius * 0.25) return null; // not a cut end
    const p = pos[v]!;
    const c = best.c;
    const r = c.radius * (cut.insideFactor ?? DEFAULTS.insideFactor);

    // In-plane tangent (world z ≡ spatial y) heading out of the arc toward the
    // tip, and the endpoint's offset from the cylinder centre.
    const q = pos[nbr]!;
    const tx = p.x - q.x;
    const tz = p.z - q.z;
    const ex = p.x - c.x;
    const ez = p.z - c.y;
    const A = tx * tx + tz * tz;
    if (A > 1e-10) {
      // Solve |e + L·t|² = r² for the first positive crossing of the inner
      // circle (smaller root, on the inward-heading branch).
      const B = 2 * (ex * tx + ez * tz);
      const C = ex * ex + ez * ez - r * r;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const L = (-B - Math.sqrt(disc)) / (2 * A);
        if (L > 0) return new Vector3(p.x + tx * L, p.y, p.z + tz * L);
      }
    }
    // Radial fallback (steep or outward-heading end).
    const dd = best.d || 1;
    return new Vector3(c.x + (ex / dd) * r, p.y, c.y + (ez / dd) * r);
  };

  const spacing = opts.sampleSpacing ?? opts.radius * 3;
  const arcs: Arc[] = [];
  for (const { seq, closed } of paths) {
    if (seq.length < opts.minLoopPoints) continue;
    const points = seq.map((w) => pos[w]!.clone());
    const colors = seq.map((w) => col[w]!.clone());
    if (!closed) {
      const head = tuck(seq[0]!, seq[1]!);
      if (head) {
        points.unshift(head);
        colors.unshift(col[seq[0]!]!.clone());
      }
      const tail = tuck(seq[seq.length - 1]!, seq[seq.length - 2]!);
      if (tail) {
        points.push(tail);
        colors.push(col[seq[seq.length - 1]!]!.clone());
      }
    }
    arcs.push(resample({ points, colors, closed }, spacing, opts.smoothPasses));
  }
  return arcs;
}

// Resample an arc to even arc-length spacing along a smooth centripetal
// Catmull-Rom through its raw points. Centripetal parameterisation gives a
// clean C¹ curve without the overshoot/self-intersection uniform Catmull-Rom
// suffers on uneven, jittery boundary data — so the resampled control points sit
// on a smooth curve rather than on jagged chords, at a resolution set by
// `spacing` instead of the mesh's triangulation density.
function resample(arc: Arc, spacing: number, smoothPasses: number): Arc {
  const { points: pts, colors: cols, closed } = arc;
  const n = pts.length;
  if (n < 2) return arc;

  const curve = new CatmullRomCurve3(pts, closed, "centripetal");
  // A dense arc-length table so even spacing stays honest on long, wiggly rims.
  curve.arcLengthDivisions = Math.min(Math.max(n * 4, 200), 20000);
  const total = curve.getLength();
  if (total === 0) return arc;

  const stations = Math.min(
    Math.max(Math.round(total / spacing), MIN_STATIONS),
    MAX_STATIONS,
  );
  // Closed loops wrap (stations points, no duplicate seam); open arcs keep both
  // ends (stations + 1 points).
  const count = closed ? stations : stations + 1;
  const segCount = closed ? n : n - 1;

  const outP: Vector3[] = new Array(count);
  const outC: Color[] = new Array(count);
  for (let k = 0; k < count; k += 1) {
    const u = k / stations;
    const t = curve.getUtoTmapping(u, u * total); // even in arc length
    outP[k] = curve.getPoint(t);
    // Map the curve parameter back to a raw segment to interpolate colour.
    const f = t * segCount;
    const i0 = Math.min(Math.floor(f), segCount - 1);
    const i1 = closed ? (i0 + 1) % n : Math.min(i0 + 1, n - 1);
    outC[k] = cols[i0]!.clone().lerp(cols[i1]!, f - i0);
  }

  for (let pass = 0; pass < smoothPasses; pass += 1) relax(outP, closed);
  return { points: outP, colors: outC, closed };
}

// One Laplacian relaxation pass: nudge each point halfway toward the midpoint of
// its neighbours. Open-arc endpoints are pinned so the tucked tips don't drift.
function relax(p: Vector3[], closed: boolean): void {
  const n = p.length;
  if (n < 3) return;
  const orig = p.map((v) => v.clone());
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  const mid = new Vector3();
  for (let i = start; i < end; i += 1) {
    const a = orig[(i - 1 + n) % n]!;
    const b = orig[(i + 1) % n]!;
    mid.copy(a).add(b).multiplyScalar(0.5);
    p[i]!.copy(orig[i]!).lerp(mid, 0.5);
  }
}

// A tube swept along one arc, coloured by the arc's inherited vertex colours.
function tubeAlong(
  arc: Arc,
  radius: number,
  radialSegments: number,
  smoothing: number,
  darken: number,
): BufferGeometry {
  const n = arc.points.length;
  const curve = new CatmullRomCurve3(arc.points, arc.closed, "catmullrom", 0.5);
  const tubular = Math.max(n * smoothing, 8);
  const geom = new TubeGeometry(curve, tubular, radius, radialSegments, arc.closed);

  const ringSpan = radialSegments + 1;
  const vertCount = geom.getAttribute("position").count;
  // RGBA (alpha = 1) — the path tracer samples vertex colour as a vec4 and folds
  // it into albedo; a 3-component attribute reads alpha 0 and turns black.
  const colors = new Float32Array(vertCount * 4);
  const tmp = new Color();
  const span = arc.closed ? n : n - 1;
  for (let v = 0; v < vertCount; v += 1) {
    const ring = Math.floor(v / ringSpan);
    const u = ring / tubular;
    const f = u * span;
    const i0 = Math.min(Math.floor(f), n - 1);
    const i1 = arc.closed ? (i0 + 1) % n : Math.min(i0 + 1, n - 1);
    tmp.copy(arc.colors[i0]!).lerp(arc.colors[i1]!, f - Math.floor(f));
    colors[v * 4] = tmp.r * darken;
    colors[v * 4 + 1] = tmp.g * darken;
    colors[v * 4 + 2] = tmp.b * darken;
    colors[v * 4 + 3] = 1;
  }
  geom.setAttribute("color", new BufferAttribute(colors, 4));
  return geom;
}
