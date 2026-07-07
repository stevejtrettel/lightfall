import {
  geodesicSystem,
  nullConeAt,
  type LorentzianManifold,
  type PhaseView,
} from "../math/lorentzian/index.ts";
import { DormandPrince, type Method } from "../math/numerics/index.ts";
import type { VectorField } from "../math/maps/index.ts";
import { Event } from "../spacetime/index.ts";

// A ray stops when this returns true: absorbed at a hole, escaped, whatever the
// spacetime deems terminal. Built from the spacetime's structure (it knows its
// holes) but passed into `lightCone`, so the cone stays spacetime-agnostic.
export type Terminator = (state: PhaseView<Event>) => boolean;

// A ray reaching within `radius` of any center is absorbed (the black-hole
// throats). Compose with the hole positions the caller already has.
export function absorbedNear(
  centers: readonly { x: number; y: number }[],
  radius: number,
): Terminator {
  const r2 = radius * radius;
  return (s) => {
    for (const c of centers) {
      const dx = s.pos.x - c.x;
      const dy = s.pos.y - c.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  };
}

export interface LightConeOptions {
  // Emission angles (radians). Build with a sampler from `samplers.ts`.
  directions: readonly number[];
  // Number of recorded samples per ray, including the apex (≥ 2).
  samples: number;
  // Affine-parameter spacing between recorded samples (the sampling
  // resolution; the integrator chooses its own internal steps).
  step: number;
  // Null normalization E = −p_t. Default 1.
  energy?: number;
  // Integrator factory. Default adaptive Dormand–Prince. Pass e.g.
  // `(f) => new RK4(f, { step: 0.02 })` to trace with a fixed-step scheme.
  method?: (flow: VectorField<PhaseView<Event>>) => Method<PhaseView<Event>>;
  // Physics termination (e.g. absorption at a hole).
  terminate?: Terminator;
  // Escape guard: stop a ray once its spatial radius exceeds this. Default ∞.
  maxRadius?: number;
}

// A computed light cone: the future null-geodesic congruence from one event,
// traced once and stored as a rectangular grid `positions[ray][sample]` of
// spacetime points (t, x, y). Every view — surface, rays, wavefront, shadow —
// reads this one grid (plan §4.1).
export class LightCone {
  readonly manifold: LorentzianManifold<Event>;
  readonly apexT: number;
  readonly apexX: number;
  readonly apexY: number;
  readonly directions: Float64Array;
  readonly lambdas: Float64Array;
  readonly positions: Float64Array; // [ray][sample][t,x,y], row-major
  readonly rayLengths: Int32Array;
  readonly rayCount: number;
  readonly sampleCount: number;

  constructor(
    manifold: LorentzianManifold<Event>,
    apex: Event,
    directions: Float64Array,
    lambdas: Float64Array,
    positions: Float64Array,
    rayLengths: Int32Array,
  ) {
    this.manifold = manifold;
    this.apexT = apex.t;
    this.apexX = apex.x;
    this.apexY = apex.y;
    this.directions = directions;
    this.lambdas = lambdas;
    this.positions = positions;
    this.rayLengths = rayLengths;
    this.rayCount = directions.length;
    this.sampleCount = lambdas.length;
  }

  coord(i: number, j: number, c: number): number {
    return this.positions[(i * this.sampleCount + j) * 3 + c]!;
  }

  ray(i: number): Float64Array {
    const start = i * this.sampleCount * 3;
    return this.positions.subarray(start, start + this.rayLengths[i]! * 3);
  }

  // The wavefront at coordinate time `time`: the constant-t slice, one point
  // per ray that has reached it, via monotone per-ray interpolation of t(λ)
  // (plan §4.1). Packed (t, x, y) triples with t = `time`.
  wavefront(time: number): Float64Array {
    const out: number[] = [];
    for (let i = 0; i < this.rayCount; i += 1) {
      const len = this.rayLengths[i]!;
      for (let j = 0; j < len - 1; j += 1) {
        const t0 = this.coord(i, j, 0);
        const t1 = this.coord(i, j + 1, 0);
        if (t0 <= time && time <= t1) {
          const f = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
          out.push(
            time,
            this.coord(i, j, 1) + f * (this.coord(i, j + 1, 1) - this.coord(i, j, 1)),
            this.coord(i, j, 2) + f * (this.coord(i, j + 1, 2) - this.coord(i, j, 2)),
          );
          break;
        }
      }
    }
    return Float64Array.from(out);
  }
}

// Trace the future light cone of `event`: one null geodesic per emission angle,
// each traced by its own Solver (the adaptive scheme carries per-ray step
// state), sampled onto a shared affine grid via `advanceTo`.
export function lightCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  options: LightConeOptions,
): LightCone {
  const { directions, samples, step } = options;
  if (!Number.isInteger(samples) || samples < 2) {
    throw new RangeError(`lightCone needs samples ≥ 2, got ${samples}`);
  }
  const energy = options.energy ?? 1;
  const maxR2 = (options.maxRadius ?? Infinity) ** 2;
  const terminate = options.terminate;
  const makeMethod = options.method ?? ((f) => new DormandPrince(f));

  const system = geodesicSystem(manifold);
  const method = makeMethod(system.field);
  const cone = nullConeAt(manifold, event, { energy });

  const nθ = directions.length;
  const nλ = samples;
  const positions = new Float64Array(nθ * nλ * 3);
  const lambdas = new Float64Array(nλ);
  for (let j = 0; j < nλ; j += 1) lambdas[j] = j * step;
  const rayLengths = new Int32Array(nθ);

  const initial = system.phase.create();
  const p = manifold.chart.create();

  for (let i = 0; i < nθ; i += 1) {
    cone.momentumInto(p, directions[i]!);
    initial.pos.set(event.t, event.x, event.y);
    initial.mom.set(p.t, p.x, p.y);
    const solver = method.solver(initial, 0);

    // apex (λ = 0) is exactly the event for every ray
    positions[i * nλ * 3] = event.t;
    positions[i * nλ * 3 + 1] = event.x;
    positions[i * nλ * 3 + 2] = event.y;
    let valid = 1;

    for (let j = 1; j < nλ; j += 1) {
      solver.advanceTo(lambdas[j]!);
      const st = solver.state;
      const t = st.pos.t;
      const x = st.pos.x;
      const y = st.pos.y;
      if (!solver.alive || x * x + y * y > maxR2 || (terminate !== undefined && terminate(st))) {
        break;
      }
      const base = (i * nλ + j) * 3;
      positions[base] = t;
      positions[base + 1] = x;
      positions[base + 2] = y;
      valid = j + 1;
    }
    rayLengths[i] = valid;

    const lastBase = (i * nλ + (valid - 1)) * 3;
    for (let j = valid; j < nλ; j += 1) {
      const base = (i * nλ + j) * 3;
      positions[base] = positions[lastBase]!;
      positions[base + 1] = positions[lastBase + 1]!;
      positions[base + 2] = positions[lastBase + 2]!;
    }
  }

  return new LightCone(manifold, event, Float64Array.from(directions), lambdas, positions, rayLengths);
}
