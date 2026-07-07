import {
  geodesicHamiltonian,
  nullConeAt,
  phaseSpace,
  type LorentzianManifold,
  type PhaseView,
} from "../math/lorentzian/index.ts";
import { RK4, type Integrator } from "../math/numerics/index.ts";
import type { VectorField } from "../math/maps/index.ts";
import { Event } from "../spacetime/index.ts";

export interface LightConeOptions {
  // Emission angles (radians). Build with a sampler from `samplers.ts`.
  directions: readonly number[];
  // Number of recorded samples per ray, including the apex (≥ 2).
  samples: number;
  // Affine-parameter spacing between recorded samples (Δλ).
  step: number;
  // Integrator sub-steps per recorded sample (dt = step / substeps). Default 1.
  substeps?: number;
  // Null normalization E = −p_t. Default 1.
  energy?: number;
  // Integrator factory. Default RK4. Pass e.g. `(f) => new ImplicitMidpoint(f)`
  // to trace with a different scheme (the adaptive scheme will slot in here).
  integrator?: (flow: VectorField<PhaseView<Event>>) => Integrator<PhaseView<Event>>;
  // Stop a ray once its spatial radius exceeds this, or its state goes
  // non-finite (a ray plunging into a hole). Default Infinity.
  maxRadius?: number;
}

// A computed light cone: the future null-geodesic congruence from one event,
// traced once and stored as a rectangular grid `positions[ray][sample]` of
// spacetime points (t, x, y). Every visualization — the swept surface, the
// rays, the constant-time wavefront, the spatial shadow — is a *view* of this
// one grid (plan §4.1), not a re-integration.
export class LightCone {
  readonly manifold: LorentzianManifold<Event>;
  readonly apexT: number;
  readonly apexX: number;
  readonly apexY: number;
  readonly directions: Float64Array; // [ray] emission angle
  readonly lambdas: Float64Array; // [sample] affine parameter (kept: tangents/momenta recoverable)
  readonly positions: Float64Array; // [ray][sample][t,x,y], row-major
  readonly rayLengths: Int32Array; // [ray] number of valid samples before termination
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

  // Coordinate `c` (0=t, 1=x, 2=y) of the sample at (ray i, sample j).
  coord(i: number, j: number, c: number): number {
    return this.positions[(i * this.sampleCount + j) * 3 + c]!;
  }

  // Ray i as a packed polyline of its valid (t, x, y) samples.
  ray(i: number): Float64Array {
    const start = i * this.sampleCount * 3;
    return this.positions.subarray(start, start + this.rayLengths[i]! * 3);
  }

  // The wavefront at coordinate time `time`: the constant-t slice of the cone
  // — everywhere the flash has reached by then (plan §4.1). Because t(λ) is
  // strictly increasing along each ray, this is a per-ray monotone
  // interpolation, one point per ray that has reached `time`. Returns packed
  // (t, x, y) triples (t = `time` for all).
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

// Trace the future light cone of `event`: one null geodesic per emission
// angle, integrated once and sampled on a shared affine grid. The apex row is
// exactly `event` for every ray (the cone's degenerate tip).
export function lightCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  options: LightConeOptions,
): LightCone {
  const { directions, samples, step } = options;
  if (!Number.isInteger(samples) || samples < 2) {
    throw new RangeError(`lightCone needs samples ≥ 2, got ${samples}`);
  }
  const substeps = options.substeps ?? 1;
  const dt = step / substeps;
  const energy = options.energy ?? 1;
  const maxR2 = (options.maxRadius ?? Infinity) ** 2;
  const makeIntegrator = options.integrator ?? ((f) => new RK4(f));

  const phase = phaseSpace(manifold);
  const integrator = makeIntegrator(geodesicHamiltonian(manifold));
  const cone = nullConeAt(manifold, event, { energy });

  const nθ = directions.length;
  const nλ = samples;
  const positions = new Float64Array(nθ * nλ * 3);
  const lambdas = new Float64Array(nλ);
  for (let j = 0; j < nλ; j += 1) lambdas[j] = j * step;
  const rayLengths = new Int32Array(nθ);

  const state = phase.create();
  const p = manifold.chart.create();

  for (let i = 0; i < nθ; i += 1) {
    cone.momentumInto(p, directions[i]!);
    state.pos.set(event.t, event.x, event.y);
    state.mom.set(p.t, p.x, p.y);

    let valid = 0;
    for (let j = 0; j < nλ; j += 1) {
      if (j > 0) integrator.flow(state, dt, substeps);
      const t = state.pos.t;
      const x = state.pos.x;
      const y = state.pos.y;
      if (!(Number.isFinite(t) && Number.isFinite(x) && Number.isFinite(y)) || x * x + y * y > maxR2) {
        break; // ray terminated (escaped or plunged into a hole)
      }
      const base = (i * nλ + j) * 3;
      positions[base] = t;
      positions[base + 1] = x;
      positions[base + 2] = y;
      valid = j + 1;
    }
    rayLengths[i] = valid;

    // Pad the remainder with the last valid point so the grid stays
    // rectangular (a render adapter reads `rayLengths` to skip the padding).
    const lastBase = (i * nλ + Math.max(valid - 1, 0)) * 3;
    for (let j = valid; j < nλ; j += 1) {
      const base = (i * nλ + j) * 3;
      positions[base] = positions[lastBase]!;
      positions[base + 1] = positions[lastBase + 1]!;
      positions[base + 2] = positions[lastBase + 2]!;
    }
  }

  return new LightCone(manifold, event, Float64Array.from(directions), lambdas, positions, rayLengths);
}
