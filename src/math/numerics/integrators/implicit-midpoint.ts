import type { SpaceView } from "../../spaces/index.ts";
import type { VectorField } from "../../maps/index.ts";
import { FixedStepSolver, type Method, type Solver } from "./solver.ts";

export interface ImplicitMidpointOptions {
  step: number;
  // Fixed-point (Picard) tolerance and iteration cap for the implicit solve.
  tol?: number;
  maxIterations?: number;
}

// The implicit midpoint rule, y_{n+1} = y_n + h·v((y_n + y_{n+1})/2), as a
// fixed-step Method. A second-order Gauss method: symplectic when the field is
// a canonical Hamiltonian flow (the caller's contract — see geodesicSystem),
// and it conserves quadratic invariants exactly. This is the first member of
// the "Hamiltonian" family; it happens to consume only a VectorField because
// the symplecticity is a property of that field, not something the scheme
// enforces. The implicit step is solved by Picard iteration.
export class ImplicitMidpoint<S extends SpaceView> implements Method<S> {
  private readonly field: VectorField<S>;
  private readonly step: number;
  private readonly tol: number;
  private readonly maxIterations: number;

  constructor(field: VectorField<S>, options: ImplicitMidpointOptions) {
    this.field = field;
    this.step = options.step;
    this.tol = options.tol ?? 1e-12;
    this.maxIterations = options.maxIterations ?? 100;
  }

  solver(y0: S, lambda0 = 0): Solver<S> {
    return new ImplicitMidpointSolver(
      this.field,
      y0,
      lambda0,
      this.step,
      this.tol,
      this.maxIterations,
    );
  }
}

class ImplicitMidpointSolver<S extends SpaceView> extends FixedStepSolver<S> {
  private readonly vf: VectorField<S>;
  private readonly tol: number;
  private readonly maxIterations: number;
  private readonly next: S;
  private readonly mid: S;
  private readonly k: S;

  constructor(
    field: VectorField<S>,
    y0: S,
    lambda0: number,
    step: number,
    tol: number,
    maxIterations: number,
  ) {
    super(field, y0, lambda0, step);
    this.vf = field;
    this.tol = tol;
    this.maxIterations = maxIterations;
    this.next = this.vs.create();
    this.mid = this.vs.create();
    this.k = this.vs.create();
  }

  protected stepOnce(dt: number): void {
    const { vs, vf } = this;
    const s = this.state;
    const n = s.dimension;
    const sBuf = s.buffer;
    const sOff = s.offset;
    const nextBuf = this.next.buffer;
    const nextOff = this.next.offset;
    const kBuf = this.k.buffer;
    const kOff = this.k.offset;

    vs.copy(this.next, s); // seed y_{n+1} = y_n

    for (let iter = 0; iter < this.maxIterations; iter += 1) {
      vs.copy(this.mid, s);
      vs.addScaled(this.mid, 1, this.next);
      vs.scale(this.mid, 0.5);
      vf.evaluateInto(this.k, this.mid);

      let change = 0;
      for (let i = 0; i < n; i += 1) {
        const updated = sBuf[sOff + i]! + dt * kBuf[kOff + i]!;
        const delta = Math.abs(updated - nextBuf[nextOff + i]!);
        if (delta > change) change = delta;
        nextBuf[nextOff + i] = updated;
      }
      if (change <= this.tol) break;
    }

    vs.copy(s, this.next);
  }
}
