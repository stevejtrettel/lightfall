import {
  geodesicSystem,
  nullConeAt,
  type LorentzianManifold,
  type NullCone,
  type PhaseView,
} from "../math/lorentzian/index.ts";
import { DormandPrince, type Method } from "../math/numerics/index.ts";
import type { VectorField } from "../math/maps/index.ts";
import { Event } from "../spacetime/index.ts";

// One traced null geodesic: its (t, x, y) samples on the shared λ grid, and how
// many are valid before the ray terminated (absorbed/escaped). Padding beyond
// `length` repeats the last valid point so the buffer is always `samples·3`.
export interface Strand {
  positions: Float64Array; // samples · 3, packed (t, x, y)
  length: number;
}

export interface RayTracerOptions {
  samples: number;
  step: number;
  energy?: number;
  method?: (flow: VectorField<PhaseView<Event>>) => Method<PhaseView<Event>>;
  maxRadius?: number;
  terminate?: (state: PhaseView<Event>) => boolean;
}

// Traces one null geodesic per emission angle from a fixed event, sampling onto
// a shared affine grid. Reused by both the uniform (`lightCone`) and adaptive
// samplers; the per-ray machinery (solver, null-cone, grid) lives here once.
export class RayTracer {
  readonly samples: number;
  readonly lambdas: Float64Array;

  private readonly method: Method<PhaseView<Event>>;
  private readonly cone: NullCone<Event>;
  private readonly initial: PhaseView<Event>;
  private readonly p: Event;
  private readonly eventT: number;
  private readonly eventX: number;
  private readonly eventY: number;
  private readonly step: number;
  private readonly maxR2: number;
  private readonly terminate: ((state: PhaseView<Event>) => boolean) | undefined;

  constructor(manifold: LorentzianManifold<Event>, event: Event, options: RayTracerOptions) {
    if (!Number.isInteger(options.samples) || options.samples < 2) {
      throw new RangeError(`RayTracer needs samples ≥ 2, got ${options.samples}`);
    }
    this.samples = options.samples;
    this.step = options.step;
    this.lambdas = new Float64Array(this.samples);
    for (let j = 0; j < this.samples; j += 1) this.lambdas[j] = j * this.step;

    const system = geodesicSystem(manifold);
    const makeMethod = options.method ?? ((f) => new DormandPrince(f));
    this.method = makeMethod(system.field);
    this.cone = nullConeAt(manifold, event, { energy: options.energy ?? 1 });
    this.initial = system.phase.create();
    this.p = manifold.chart.create();
    this.eventT = event.t;
    this.eventX = event.x;
    this.eventY = event.y;
    this.maxR2 = (options.maxRadius ?? Infinity) ** 2;
    this.terminate = options.terminate;
  }

  trace(theta: number): Strand {
    const nL = this.samples;
    const positions = new Float64Array(nL * 3);

    this.cone.momentumInto(this.p, theta);
    this.initial.pos.set(this.eventT, this.eventX, this.eventY);
    this.initial.mom.set(this.p.t, this.p.x, this.p.y);
    const solver = this.method.solver(this.initial, 0);

    positions[0] = this.eventT;
    positions[1] = this.eventX;
    positions[2] = this.eventY;
    let valid = 1;

    for (let j = 1; j < nL; j += 1) {
      solver.advanceTo(this.lambdas[j]!);
      const st = solver.state;
      const t = st.pos.t;
      const x = st.pos.x;
      const y = st.pos.y;
      if (!solver.alive || x * x + y * y > this.maxR2 || (this.terminate !== undefined && this.terminate(st))) {
        break;
      }
      positions[j * 3] = t;
      positions[j * 3 + 1] = x;
      positions[j * 3 + 2] = y;
      valid = j + 1;
    }

    const lastBase = (valid - 1) * 3;
    for (let j = valid; j < nL; j += 1) {
      positions[j * 3] = positions[lastBase]!;
      positions[j * 3 + 1] = positions[lastBase + 1]!;
      positions[j * 3 + 2] = positions[lastBase + 2]!;
    }
    return { positions, length: valid };
  }
}
