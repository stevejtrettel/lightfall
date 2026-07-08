import type { LorentzianManifold, PhaseView } from "../math/lorentzian/index.ts";
import type { Method } from "../math/numerics/index.ts";
import type { VectorField } from "../math/maps/index.ts";
import { Event } from "../spacetime/index.ts";
import { RayTracer, type Strand } from "./trace.ts";
import { assembleCone, type LightCone } from "./light-cone.ts";

export interface AdaptiveConeOptions {
  samples: number;
  step: number;
  energy?: number;
  method?: (flow: VectorField<PhaseView<Event>>) => Method<PhaseView<Event>>;
  maxRadius?: number;
  terminate?: (state: PhaseView<Event>) => boolean;

  // Angular refinement (all defaulted).
  initialRays?: number; // seed ring size, default 24
  toleranceRel?: number; // εrel — curvature tolerance vs. ribbon width, default 0.15
  minAngle?: number; // hard angular floor on gap width, default 2π/2048
  maxRays?: number; // ray budget, default 3000
  fateSamples?: number; // shadow-boundary length-mismatch threshold, default 3
  // Absolute endpoint-separation cap for gaps between two ESCAPING rays (rays
  // that reached the full affine length, not absorbed). The curvature test is
  // blind to a smoothly-diverging fan — neighbours drift far apart while the
  // surface between them stays planar — so a big flat triangle passes. This cap
  // splits any escaping gap whose endpoints are farther apart than it, bounding
  // triangle size where the congruence stretches thin (strong lensing). Absorbed
  // rays are excluded: their endpoints pile onto the horizon tube and get
  // trimmed, so refining them is wasted. Off (undefined) ⇒ no size cap.
  maxEscapeGap?: number;
}

export interface AdaptiveReport {
  rayCount: number;
  // false ⇒ the ray budget was hit before every gap met tolerance (the cone is
  // usable but not fully resolved — no silent caps).
  converged: boolean;
  // Widest remaining separation between neighbouring escaping endpoints (world
  // units) — the largest stretched-thin triangle left in the visible surface.
  worstGap: number;
}

const TWO_PI = 2 * Math.PI;

interface Entry {
  theta: number;
  strand: Strand;
}

// Maximum interpolation error of the midpoint strand against the chord of its
// neighbors, in intrinsic (t, x, y). Measured over the FULL padded extent, not
// the common valid length: strands are padded past termination with their last
// point (trace.ts), so a ray that plunges into the hole while its neighbors
// wind on registers a large error at large λ — exactly the strongly-lensed
// surface that a min-length window clips away and leaves under-sampled.
function interpError(lo: Strand, mid: Strand, hi: Strand): number {
  const n = mid.positions.length / 3; // full grid; all strands share it
  const a = lo.positions;
  const b = mid.positions;
  const c = hi.positions;
  let max = 0;
  for (let j = 0; j < n; j += 1) {
    const o = j * 3;
    const ex = b[o]! - 0.5 * (a[o]! + c[o]!);
    const ey = b[o + 1]! - 0.5 * (a[o + 1]! + c[o + 1]!);
    const et = b[o + 2]! - 0.5 * (a[o + 2]! + c[o + 2]!);
    const e = Math.sqrt(ex * ex + ey * ey + et * et);
    if (e > max) max = e;
  }
  return max;
}

// Ribbon width: the largest neighbor separation, over the full padded extent so
// it scales the relative tolerance by the true local surface span (including the
// lensed far field), matching interpError's window.
function ribbonWidth(lo: Strand, hi: Strand): number {
  const n = lo.positions.length / 3;
  const a = lo.positions;
  const c = hi.positions;
  let max = 0;
  for (let j = 0; j < n; j += 1) {
    const o = j * 3;
    const dx = a[o]! - c[o]!;
    const dy = a[o + 1]! - c[o + 1]!;
    const dt = a[o + 2]! - c[o + 2]!;
    const d = Math.sqrt(dx * dx + dy * dy + dt * dt);
    if (d > max) max = d;
  }
  return max;
}

// One angular gap under consideration: its two bracketing rays and the already-
// traced midpoint that would split it, ranked by `priority` — how far the
// midpoint exceeds the local tolerance (∞ for a fate boundary). Refinement pops
// the highest-priority gap globally, so a fixed ray budget lands on the most
// non-linear gaps everywhere rather than being spent depth-first on the first
// fold it descends into.
interface Gap {
  loT: number;
  loS: Strand;
  hiT: number;
  hiS: Strand;
  midT: number;
  midS: Strand;
  priority: number;
}

// A binary max-heap of gaps keyed by priority. Small and local; avoids re-
// sorting the frontier on every split (O(log n) push/pop vs. O(n log n)).
class GapHeap {
  private readonly h: Gap[] = [];
  get size(): number {
    return this.h.length;
  }
  push(g: Gap): void {
    const h = this.h;
    h.push(g);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p]!.priority >= h[i]!.priority) break;
      [h[p], h[i]] = [h[i]!, h[p]!];
      i = p;
    }
  }
  pop(): Gap {
    const h = this.h;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && h[l]!.priority > h[m]!.priority) m = l;
        if (r < h.length && h[r]!.priority > h[m]!.priority) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i]!, h[m]!];
        i = m;
      }
    }
    return top;
  }
}

// Choose emission angles adaptively: seed a coarse ring, then repeatedly split
// the globally worst gap until the ray budget runs out or the angular floor is
// hit. A gap's badness is the largest of three ratios (see makeGap):
//   • fate mismatch (∞) — neighbours with divergent fates, the shadow boundary;
//   • curvature — midpoint deviating from the neighbour chord vs. tolerance;
//   • endpoint separation — escaping neighbours drifting apart vs. maxEscapeGap.
// With a tiny maxEscapeGap and a deep minAngle this is a pure budget-driven,
// worst-first fill: every ray lands in the current widest gap. See docs/plans/
// adaptive-angular-sampling.md.
export function adaptiveDirections(
  tracer: RayTracer,
  options: AdaptiveConeOptions,
): { thetas: number[]; strands: Strand[]; report: AdaptiveReport } {
  const n0 = options.initialRays ?? 24;
  const epsRel = options.toleranceRel ?? 0.15;
  const minAngle = options.minAngle ?? TWO_PI / 2048;
  const maxRays = options.maxRays ?? 3000;
  const fateSamples = options.fateSamples ?? 3;
  const maxEscapeGap = options.maxEscapeGap;

  const fateMismatch = (lo: Strand, hi: Strand): boolean =>
    Math.abs(lo.length - hi.length) > fateSamples &&
    Math.min(lo.length, hi.length) < tracer.samples;

  // A ray "escaped" if it ran the full affine length (never absorbed / left the
  // domain). Only escaping neighbours get the endpoint-separation cap.
  const escaped = (s: Strand): boolean => s.length === tracer.samples;
  const endpointSep = (a: Strand, b: Strand): number => {
    const oa = (a.length - 1) * 3;
    const ob = (b.length - 1) * 3;
    return Math.hypot(
      a.positions[oa]! - b.positions[ob]!,
      a.positions[oa + 1]! - b.positions[ob + 1]!,
      a.positions[oa + 2]! - b.positions[ob + 2]!,
    );
  };

  const seed: Entry[] = [];
  for (let k = 0; k < n0; k += 1) {
    const theta = (TWO_PI * k) / n0;
    seed.push({ theta, strand: tracer.trace(theta) });
  }

  const inserted: Entry[] = [];
  let kept = n0;
  let converged = true;

  // Trace a gap's midpoint and score it. `priority` is the max of the criterion
  // ratios (each ≥ 1 means "needs splitting"): ∞ for a fate mismatch so shadow
  // edges refine first; the curvature ratio interpError/tolerance; and, for two
  // escaping neighbours, the endpoint-size ratio. The traced midpoint rides on
  // the gap so an accepted split reuses it instead of re-tracing.
  const makeGap = (loT: number, loS: Strand, hiT: number, hiS: Strand): Gap => {
    const midT = 0.5 * (loT + hiT);
    const midS = tracer.trace(midT);
    const tol = epsRel * ribbonWidth(loS, hiS);
    const err = interpError(loS, midS, hiS);
    let priority = fateMismatch(loS, hiS) ? Infinity : err / Math.max(tol, 1e-300);
    if (maxEscapeGap !== undefined && escaped(loS) && escaped(hiS)) {
      priority = Math.max(priority, endpointSep(loS, hiS) / maxEscapeGap);
    }
    return { loT, loS, hiT, hiS, midT, midS, priority };
  };

  const heap = new GapHeap();
  for (let k = 0; k < n0; k += 1) {
    const lo = seed[k]!;
    const hi = k < n0 - 1 ? seed[k + 1]! : { theta: seed[0]!.theta + TWO_PI, strand: seed[0]!.strand };
    heap.push(makeGap(lo.theta, lo.strand, hi.theta, hi.strand));
  }

  while (heap.size > 0) {
    const g = heap.pop();
    if (g.priority <= 1) break; // worst gap is within tolerance ⇒ all are: done
    if (g.hiT - g.loT <= minAngle) continue; // at the angular floor: leave as-is
    if (kept >= maxRays) {
      converged = false;
      break;
    }
    kept += 1;
    inserted.push({ theta: g.midT, strand: g.midS });
    heap.push(makeGap(g.loT, g.loS, g.midT, g.midS));
    heap.push(makeGap(g.midT, g.midS, g.hiT, g.hiS));
  }

  const all = [...seed, ...inserted].map((e) => ({
    theta: ((e.theta % TWO_PI) + TWO_PI) % TWO_PI,
    strand: e.strand,
  }));
  all.sort((a, b) => a.theta - b.theta);

  // The widest remaining escaping-endpoint gap — the largest stretched-thin
  // triangle left. Near the photon sphere it plateaus (log singularity), so it
  // reads as "how well-resolved is the worst spot" better than `converged`.
  let worstGap = 0;
  for (let i = 0; i < all.length; i += 1) {
    const a = all[i]!.strand;
    const b = all[(i + 1) % all.length]!.strand;
    if (a.length === tracer.samples && b.length === tracer.samples) {
      worstGap = Math.max(worstGap, endpointSep(a, b));
    }
  }

  return {
    thetas: all.map((e) => e.theta),
    strands: all.map((e) => e.strand),
    report: { rayCount: all.length, converged, worstGap },
  };
}

// The light cone with adaptively-chosen emission angles: dense where the
// surface curves (lensing, caustics, the shadow edge), coarse where it doesn't.
// Returns the cone plus a convergence report.
export function adaptiveLightCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  options: AdaptiveConeOptions,
): { cone: LightCone; report: AdaptiveReport } {
  const tracer = new RayTracer(manifold, event, {
    samples: options.samples,
    step: options.step,
    ...(options.energy !== undefined ? { energy: options.energy } : {}),
    ...(options.method !== undefined ? { method: options.method } : {}),
    ...(options.maxRadius !== undefined ? { maxRadius: options.maxRadius } : {}),
    ...(options.terminate !== undefined ? { terminate: options.terminate } : {}),
  });
  const { thetas, strands, report } = adaptiveDirections(tracer, options);
  return { cone: assembleCone(manifold, event, thetas, strands, tracer.lambdas), report };
}
