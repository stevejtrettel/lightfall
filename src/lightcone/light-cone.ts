import type { LorentzianManifold, PhaseView } from "../math/lorentzian/index.ts";
import type { Method } from "../math/numerics/index.ts";
import type { VectorField } from "../math/maps/index.ts";
import { Event } from "../spacetime/index.ts";
import { RayTracer, type Strand } from "./trace.ts";

// A ray stops when this returns true: absorbed at a hole, escaped, whatever the
// spacetime deems terminal. Built from the spacetime's structure (it knows its
// holes) but passed into the samplers, so the cone stays spacetime-agnostic.
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

// Like `absorbedNear`, but each center carries its own throat radius — so holes
// of different mass absorb at different sizes.
export function absorbedWithin(
  centers: readonly { x: number; y: number; radius: number }[],
): Terminator {
  return (s) => {
    for (const c of centers) {
      const dx = s.pos.x - c.x;
      const dy = s.pos.y - c.y;
      if (dx * dx + dy * dy < c.radius * c.radius) return true;
    }
    return false;
  };
}

export interface LightConeOptions {
  // Emission angles (radians), sorted. Build with a sampler from `samplers.ts`.
  directions: readonly number[];
  samples: number;
  step: number;
  energy?: number;
  method?: (flow: VectorField<PhaseView<Event>>) => Method<PhaseView<Event>>;
  terminate?: Terminator;
  maxRadius?: number;
}

// A computed light cone: the future null-geodesic congruence from one event,
// stored as a rectangular grid `positions[ray][sample]` of spacetime points
// (t, x, y). Rays are ordered by emission angle (uniform or adaptive — the grid
// does not care). Every view — surface, rays, wavefront, shadow — reads this
// one grid (plan §4.1).
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

// Pack a set of angle-ordered strands (all on `lambdas`) into a LightCone.
export function assembleCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  thetas: readonly number[],
  strands: readonly Strand[],
  lambdas: Float64Array,
): LightCone {
  const nT = thetas.length;
  const nL = lambdas.length;
  const positions = new Float64Array(nT * nL * 3);
  const rayLengths = new Int32Array(nT);
  for (let i = 0; i < nT; i += 1) {
    positions.set(strands[i]!.positions, i * nL * 3);
    rayLengths[i] = strands[i]!.length;
  }
  return new LightCone(
    manifold,
    event,
    Float64Array.from(thetas),
    lambdas.slice(),
    positions,
    rayLengths,
  );
}

// Trace the future light cone of `event` at the given emission angles (uniform
// or any fixed set). For angle-adaptive sampling, see `adaptiveLightCone`.
export function lightCone(
  manifold: LorentzianManifold<Event>,
  event: Event,
  options: LightConeOptions,
): LightCone {
  const tracer = new RayTracer(manifold, event, {
    samples: options.samples,
    step: options.step,
    ...(options.energy !== undefined ? { energy: options.energy } : {}),
    ...(options.method !== undefined ? { method: options.method } : {}),
    ...(options.maxRadius !== undefined ? { maxRadius: options.maxRadius } : {}),
    ...(options.terminate !== undefined ? { terminate: options.terminate } : {}),
  });
  const thetas = [...options.directions];
  const strands = thetas.map((t) => tracer.trace(t));
  return assembleCone(manifold, event, thetas, strands, tracer.lambdas);
}
