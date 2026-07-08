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
  toleranceRel: number; // angular refinement tolerance
  maxRays: number; // budget
  samples: number; // λ samples per ray (cheap — DOPRI5 already adapts internally)
  rtol: number; // integrator tolerances
  atol: number;
  // Hard angular floor — how deep bisection may go. The default (2π/2048) is too
  // shallow for the photon-sphere shadow edge, where the endpoint gap shrinks
  // only logarithmically; lower it to let the endpoint cap keep subdividing.
  minAngle?: number;
}

// Interactive: sub-second, good enough to orbit.
export const COARSE_CONE: ConeQuality = {
  initialRays: 40,
  toleranceRel: 0.12,
  maxRays: 800,
  // λ samples per ray. Enough to keep the fast-climbing near-horizon region
  // smooth (dt/dλ = U² is large there), but no more: meshing cost scales with
  // samples × rays and dominates the interactive rebuild, and past ~400 the
  // extra rings are visually indistinguishable (verified against 700).
  samples: 400,
  rtol: 1e-7,
  atol: 1e-9,
};

// Hero still. Dense seed brackets thin folds/edges; tight tolerance and a big
// budget so complex/strong-lensing scenes actually spend it; fine λ mesh and
// tight integration. On a smooth scene it converges early and stays fast; on a
// rich one it scales up to thousands of rays.
export const REFINE_CONE: ConeQuality = {
  initialRays: 220,
  toleranceRel: 0.004,
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
  // Absolute cap on the endpoint separation of neighbouring escaping rays —
  // bounds triangle size in the stretched-thin lensed fans (see adaptive.ts).
  // Scene-scale (grows with lambdaMax), so it lives here, not in the preset.
  maxEscapeGap?: number;
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
  return adaptiveLightCone(manifold, event, {
    samples: quality.samples,
    step,
    initialRays: quality.initialRays,
    toleranceRel: quality.toleranceRel,
    maxRays: quality.maxRays,
    ...(quality.minAngle !== undefined ? { minAngle: quality.minAngle } : {}),
    // A tiny minStep lets the integrator keep shrinking its step and crawl
    // deep into the throat (where U² blows up) instead of flooring early and
    // stopping at a scattered radius.
    method: (f) => new DormandPrince(f, { rtol: quality.rtol, atol: quality.atol, minStep: 1e-14 }),
    ...(scene.maxRadius !== undefined ? { maxRadius: scene.maxRadius } : {}),
    ...(scene.terminate !== undefined ? { terminate: scene.terminate } : {}),
    ...(scene.energy !== undefined ? { energy: scene.energy } : {}),
    ...(scene.maxEscapeGap !== undefined ? { maxEscapeGap: scene.maxEscapeGap } : {}),
  });
}
