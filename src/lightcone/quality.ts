import type { LorentzianManifold } from "../math/lorentzian/index.ts";
import { DormandPrince } from "../math/numerics/index.ts";
import { Event } from "../spacetime/index.ts";
import { adaptiveLightCone, type AdaptiveReport } from "./adaptive.ts";
import type { LightCone, Terminator } from "./light-cone.ts";

// A quality preset: the knobs that trade cost against resolution. Everything
// here is about *how well* the cone is sampled; the scene (apex, holes, how far
// to trace) is separate. See docs/plans/adaptive-angular-sampling.md — ray
// count dominates cost, λ samples are nearly free, and the seed-ring density is
// what lets refine catch the thin features coarse misses.
export interface ConeQuality {
  initialRays: number; // seed ring — density here decides which thin features are found
  // Refinement tolerances, as fractions of the trace length (lambdaMax); buildCone
  // scales them to absolute world units. Both are absolute-per-gap once scaled, so
  // the empty far field and the lensed core refine independently — tightening one
  // never floods the other (see adaptive.ts).
  sagTol: number; // surface-flatness tolerance (chord deviation) — resolves folds/lensing
  edgeTol: number; // element-size tolerance (neighbour separation) — sets the even sampling density
  maxRays: number; // budget
  samples: number; // λ samples per ray (cheap — DOPRI5 already adapts internally)
  rtol: number; // integrator tolerances
  atol: number;
  // Hard angular floor — how deep bisection may go. The default (2π/2048) is too
  // shallow for the photon-sphere shadow edge, where the endpoint gap shrinks
  // only logarithmically; lower it to let the size test keep subdividing.
  minAngle?: number;
}

// Interactive: sub-second, good enough to orbit.
export const COARSE_CONE: ConeQuality = {
  initialRays: 40,
  sagTol: 0.01, // ~1% of the trace length — smooth enough to orbit
  edgeTol: 0.02, // ~2% — evenly sampled without a heavy ray count
  maxRays: 800,
  // λ samples per ray. Enough to keep the fast-climbing near-horizon region
  // smooth (dt/dλ = U² is large there), but no more: meshing cost scales with
  // samples × rays and dominates the interactive rebuild, and past ~400 the
  // extra rings are visually indistinguishable (verified against 700).
  samples: 400,
  rtol: 1e-7,
  atol: 1e-9,
};

// Hero still. Dense seed brackets thin folds/edges; tight tolerances and a big
// budget so complex/strong-lensing scenes actually spend it; fine λ mesh and
// tight integration. On a smooth scene it converges early and stays fast; on a
// rich one it scales up to thousands of rays. The tight sagTol sharpens the
// lensed core; edgeTol stays moderate so the calm sky is *not* over-refined.
export const REFINE_CONE: ConeQuality = {
  initialRays: 220,
  sagTol: 0.0005,
  edgeTol: 0.008,
  maxRays: 30000,
  samples: 2000,
  rtol: 1e-10,
  atol: 1e-12,
};

// The scene-specific inputs, independent of quality.
export interface ConeSceneOptions {
  lambdaMax: number; // how far along the rays to trace (affine parameter)
  maxRadius?: number;
  terminate?: Terminator;
  energy?: number;
}

// Build a light cone at a chosen quality. Same pipeline for coarse and refine;
// only the preset differs.
export function buildCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  quality: ConeQuality,
  scene: ConeSceneOptions,
): { cone: LightCone; report: AdaptiveReport } {
  const step = scene.lambdaMax / (quality.samples - 1);
  // The refinement tolerances are fractions of the trace length; scale them to
  // the absolute world units adaptive.ts compares against.
  return adaptiveLightCone(manifold, event, {
    samples: quality.samples,
    step,
    initialRays: quality.initialRays,
    sagTol: quality.sagTol * scene.lambdaMax,
    edgeTol: quality.edgeTol * scene.lambdaMax,
    maxRays: quality.maxRays,
    ...(quality.minAngle !== undefined ? { minAngle: quality.minAngle } : {}),
    // A tiny minStep lets the integrator keep shrinking its step and crawl
    // deep into the throat (where U² blows up) instead of flooring early and
    // stopping at a scattered radius.
    method: (f) => new DormandPrince(f, { rtol: quality.rtol, atol: quality.atol, minStep: 1e-14 }),
    ...(scene.maxRadius !== undefined ? { maxRadius: scene.maxRadius } : {}),
    ...(scene.terminate !== undefined ? { terminate: scene.terminate } : {}),
    ...(scene.energy !== undefined ? { energy: scene.energy } : {}),
  });
}
