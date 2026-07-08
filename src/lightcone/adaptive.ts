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

  // Angular refinement (all defaulted). The split test compares two *absolute*
  // world-unit tolerances against the surface between neighbouring rays; both are
  // scene-scaled, so callers pass them as fractions of the trace length (see
  // buildCone). Measuring absolutely — rather than relative to each gap's own
  // width — is deliberate: a per-gap ratio treats the trivial circular spreading
  // of the empty sky as just as "curved" as a real lens, so tightening it to
  // resolve the hole floods the boring far field with rays. Absolute tolerances
  // keep the two decoupled: the sky is bounded by edgeTol alone, the lens by
  // sagTol/fate, so you can sharpen one without paying for the other.
  initialRays?: number; // seed ring size, default 24
  // Surface-flatness tolerance (world units): split while the traced midpoint
  // strand deviates from the neighbour chord by more than this. Catches caustic
  // folds where neighbours stay close but the surface bows. Default 0.05.
  sagTol?: number;
  // Element-size tolerance (world units): split while neighbouring strands are
  // farther apart than this anywhere along their valid extent. Bounds triangle
  // size ⇒ even sampling, and fills the stretched-thin lensed fans that the sag
  // test alone misses (a big flat triangle has low sag but a large edge).
  // Default 0.1.
  edgeTol?: number;
  minAngle?: number; // hard angular floor on gap width, default 2π/2048
  maxRays?: number; // ray budget, default 3000
  fateSamples?: number; // shadow-boundary length-mismatch threshold, default 3
}

export interface AdaptiveReport {
  rayCount: number;
  // false ⇒ the ray budget was hit before every gap met tolerance (the cone is
  // usable but not fully resolved — no silent caps).
  converged: boolean;
  // Widest remaining separation between two ESCAPING neighbours over their valid
  // extent (world units) — the largest stretched-thin triangle in the continuous
  // visible surface (fate boundaries excluded, since their edge is irreducible).
  // Near the photon sphere it plateaus (log singularity), so it reads as "how
  // well-resolved is the worst spot" better than `converged`.
  worstGap: number;
}

const TWO_PI = 2 * Math.PI;

interface Entry {
  theta: number;
  strand: Strand;
}

// Maximum deviation of the midpoint strand from the chord of its neighbors, in
// intrinsic (t, x, y) — the surface's flatness error. Measured over the common
// VALID extent (min of the three lengths), never the padded tail: past
// termination the strands are frozen at their last point (trace.ts), which is
// fake geometry. When lengths diverge (one ray plunges in while its neighbours
// wind on) the fate test below fires with ∞ priority and refines that boundary,
// so the honest common-extent window loses nothing there while staying free of
// padding artefacts.
function sagError(lo: Strand, mid: Strand, hi: Strand): number {
  const n = Math.min(lo.length, mid.length, hi.length);
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

// Largest separation between two neighbouring strands over their common valid
// extent — the widest triangle edge the gap would leave. Absorbed rays count
// only up to the point they were absorbed (real, visible geometry); their frozen
// tails are excluded.
function edgeSpan(lo: Strand, hi: Strand): number {
  const n = Math.min(lo.length, hi.length);
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
// hit. A gap's badness is the largest of three criterion ratios (see makeGap):
//   • fate mismatch (∞) — neighbours with divergent fates, the shadow boundary;
//   • curvature — midpoint deviating from the neighbour chord vs. sagTol;
//   • element size — neighbours drifting apart vs. edgeTol.
// Both length criteria are absolute (world units), so the boring far field and
// the lensed core refine independently. With a tiny edgeTol and a deep minAngle
// this is a pure budget-driven, worst-first fill: every ray lands in the current
// widest gap. See docs/plans/adaptive-angular-sampling.md.
export function adaptiveDirections(
  tracer: RayTracer,
  options: AdaptiveConeOptions,
): { thetas: number[]; strands: Strand[]; report: AdaptiveReport } {
  const n0 = options.initialRays ?? 24;
  const sagTol = options.sagTol ?? 0.05;
  const edgeTol = options.edgeTol ?? 0.1;
  const minAngle = options.minAngle ?? TWO_PI / 2048;
  const maxRays = options.maxRays ?? 3000;
  const fateSamples = options.fateSamples ?? 3;

  const fateMismatch = (lo: Strand, hi: Strand): boolean =>
    Math.abs(lo.length - hi.length) > fateSamples &&
    Math.min(lo.length, hi.length) < tracer.samples;

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
  // edges refine first; the curvature ratio sagError/sagTol; and the element-size
  // ratio edgeSpan/edgeTol. The traced midpoint rides on the gap so an accepted
  // split reuses it instead of re-tracing.
  const makeGap = (loT: number, loS: Strand, hiT: number, hiS: Strand): Gap => {
    const midT = 0.5 * (loT + hiT);
    const midS = tracer.trace(midT);
    const priority = fateMismatch(loS, hiS)
      ? Infinity
      : Math.max(sagError(loS, midS, hiS) / sagTol, edgeSpan(loS, hiS) / edgeTol);
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

  // The widest remaining separation between two ESCAPING neighbours over their
  // valid extent — the largest stretched-thin triangle in the *continuous*
  // visible surface. Fate boundaries are excluded on purpose: the surface tears
  // there, so its edge is irreducible (floor-limited) and would pin this gauge to
  // a constant. Escaping-only, it stays budget-responsive; near the photon sphere
  // it plateaus (log singularity), reading as "how resolved is the worst spot".
  let worstGap = 0;
  for (let i = 0; i < all.length; i += 1) {
    const a = all[i]!.strand;
    const b = all[(i + 1) % all.length]!.strand;
    if (a.length === tracer.samples && b.length === tracer.samples) {
      worstGap = Math.max(worstGap, edgeSpan(a, b));
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
