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

  // Angular refinement (all defaulted). A gap is ranked by the *element-size*
  // test: the largest separation between its two bracketing rays anywhere along
  // their valid extent (edgeSpan). It is absolute (world units) and scene-scaled,
  // so callers pass it as a fraction of the trace length (see buildCone).
  // Measuring absolutely — rather than relative to each gap's own width — is
  // deliberate: a per-gap ratio treats the trivial circular spreading of the
  // empty sky as just as "curved" as a real lens, flooding the far field when you
  // tighten to resolve the hole. Absolute keeps sky and lens decoupled.
  //
  // Scoring from the two *already-traced* bracketing rays means a gap costs
  // nothing to rank — the midpoint geodesic is traced only when the gap is
  // actually cut (one trace per kept ray, not three). A caustic fold where the
  // neighbours stay close but the surface bows between them is caught one round
  // late: the instant the gap is cut, the bulging midpoint makes both sub-gaps'
  // edges large, so they rank high next round.
  initialRays?: number; // seed ring size, default 24
  // Element-size tolerance (world units): split while neighbouring strands are
  // farther apart than this anywhere along their valid extent. Bounds triangle
  // size ⇒ even sampling, and fills the stretched-thin lensed fans.
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

// Largest separation between two neighbouring strands over their common valid
// extent — the widest triangle edge the gap would leave, and the sole refinement
// criterion (besides fate). Because divergence is monotone for ~99% of gaps the
// max usually sits at the far end, but scanning the whole extent is free (it
// reads points already computed) and catches the ~1% caustic gaps where the rays
// cross and re-diverge, so the max is interior. Absorbed rays count only up to
// the point they were absorbed (real, visible geometry); frozen tails excluded.
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

// One angular gap under consideration: its two bracketing rays, ranked by
// `priority` — how far the edge between them exceeds edgeTol (∞ for a fate
// boundary). Ranked from the already-traced brackets alone, so no geodesic is
// traced until the gap is popped and cut. Refinement pops the highest-priority
// gap globally, so a fixed ray budget lands on the widest edges everywhere
// rather than being spent depth-first on the first fold it descends into.
interface Gap {
  loT: number;
  loS: Strand;
  hiT: number;
  hiS: Strand;
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
// hit. A gap's badness is the larger of two criterion ratios (see makeGap):
//   • fate mismatch (∞) — neighbours with divergent fates, the shadow boundary;
//   • element size — the widest separation between the two bracketing rays vs.
//     edgeTol (edgeSpan).
// edgeSpan reads only the already-traced brackets, so a gap is free to rank; the
// midpoint geodesic is traced only when the gap is cut (one trace per kept ray).
// With a tiny edgeTol and a deep minAngle this is a pure budget-driven, worst-
// first fill: every ray lands in the current widest gap. See
// docs/plans/adaptive-angular-sampling.md.
export function adaptiveDirections(
  tracer: RayTracer,
  options: AdaptiveConeOptions,
): { thetas: number[]; strands: Strand[]; report: AdaptiveReport } {
  const n0 = options.initialRays ?? 24;
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

  // Score a gap from its two bracketing rays alone — no midpoint traced. The
  // `priority` (≥ 1 means "needs splitting") is ∞ for a fate mismatch so shadow
  // edges refine first, else the element-size ratio edgeSpan/edgeTol.
  const makeGap = (loT: number, loS: Strand, hiT: number, hiS: Strand): Gap => {
    const priority = fateMismatch(loS, hiS) ? Infinity : edgeSpan(loS, hiS) / edgeTol;
    return { loT, loS, hiT, hiS, priority };
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
    // Only now, on an accepted cut, is the midpoint geodesic traced — the single
    // trace this split costs. The two sub-gaps are ranked from it and its
    // neighbours, so a fold it reveals surfaces as large sub-gap edges next round.
    const midT = 0.5 * (g.loT + g.hiT);
    const midS = tracer.trace(midT);
    kept += 1;
    inserted.push({ theta: midT, strand: midS });
    heap.push(makeGap(g.loT, g.loS, midT, midS));
    heap.push(makeGap(midT, midS, g.hiT, g.hiS));
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
