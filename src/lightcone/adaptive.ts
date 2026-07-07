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
  toleranceRel?: number; // εrel — far-field faceting tolerance, default 0.15
  toleranceAbs?: number; // εabs — caustic floor on error, default 0
  minAngle?: number; // hard angular floor, default 2π/2048
  maxRays?: number; // budget, default 3000
  fateSamples?: number; // shadow-boundary length-mismatch threshold, default 3
}

export interface AdaptiveReport {
  rayCount: number;
  // false ⇒ the ray budget was hit before every gap met tolerance (the cone is
  // usable but not fully resolved — no silent caps).
  converged: boolean;
}

const TWO_PI = 2 * Math.PI;

interface Entry {
  theta: number;
  strand: Strand;
}

// Maximum interpolation error of the midpoint strand against the chord of its
// neighbors, over their common valid length, in intrinsic (t, x, y).
function interpError(lo: Strand, mid: Strand, hi: Strand): number {
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

// Ribbon width: the largest neighbor separation over the common valid length.
function ribbonWidth(lo: Strand, hi: Strand): number {
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

// Choose emission angles adaptively: seed a coarse ring, then bisect any gap
// whose midpoint deviates from the neighbor chord by more than the relative
// tolerance (or whose neighbors have divergent fates — the shadow boundary),
// down to the angular floor / ray budget. See docs/plans/adaptive-angular-
// sampling.md.
export function adaptiveDirections(
  tracer: RayTracer,
  options: AdaptiveConeOptions,
): { thetas: number[]; strands: Strand[]; report: AdaptiveReport } {
  const n0 = options.initialRays ?? 24;
  const epsRel = options.toleranceRel ?? 0.15;
  const epsAbs = options.toleranceAbs ?? 0;
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

  const refine = (loT: number, loS: Strand, hiT: number, hiS: Strand): void => {
    if (hiT - loT <= minAngle) return;
    const midT = 0.5 * (loT + hiT);
    const midS = tracer.trace(midT);
    const needed =
      interpError(loS, midS, hiS) > epsAbs + epsRel * ribbonWidth(loS, hiS) ||
      fateMismatch(loS, hiS);
    if (!needed) return; // gap is locally flat: discard the test ray
    if (kept >= maxRays) {
      converged = false;
      return;
    }
    kept += 1;
    inserted.push({ theta: midT, strand: midS });
    refine(loT, loS, midT, midS);
    refine(midT, midS, hiT, hiS);
  };

  for (let k = 0; k < n0; k += 1) {
    const lo = seed[k]!;
    const hi = k < n0 - 1 ? seed[k + 1]! : { theta: seed[0]!.theta + TWO_PI, strand: seed[0]!.strand };
    refine(lo.theta, lo.strand, hi.theta, hi.strand);
  }

  const all = [...seed, ...inserted].map((e) => ({
    theta: ((e.theta % TWO_PI) + TWO_PI) % TWO_PI,
    strand: e.strand,
  }));
  all.sort((a, b) => a.theta - b.theta);

  return {
    thetas: all.map((e) => e.theta),
    strands: all.map((e) => e.strand),
    report: { rayCount: all.length, converged },
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
