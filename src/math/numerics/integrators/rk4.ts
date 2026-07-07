import type { SpaceView } from "../../spaces/index.ts";
import type { VectorField } from "../../maps/index.ts";
import { FixedStepSolver, type Method, type Solver } from "./solver.ts";

export interface RK4Options {
  // Fixed sub-step size (affine parameter). advanceTo subdivides to land on
  // targets exactly, so this is the target sub-step, not a hard grid.
  step: number;
}

// Classical 4-stage Runge–Kutta as a fixed-step Method. Fourth-order,
// explicit, non-symplectic — the cheap workhorse and the validation anchor.
export class RK4<S extends SpaceView> implements Method<S> {
  private readonly field: VectorField<S>;
  private readonly step: number;

  constructor(field: VectorField<S>, options: RK4Options) {
    this.field = field;
    this.step = options.step;
  }

  solver(y0: S, lambda0 = 0): Solver<S> {
    return new RK4Solver(this.field, y0, lambda0, this.step);
  }
}

class RK4Solver<S extends SpaceView> extends FixedStepSolver<S> {
  private readonly vf: VectorField<S>;
  private readonly k1: S;
  private readonly k2: S;
  private readonly k3: S;
  private readonly k4: S;
  private readonly scratch: S;

  constructor(field: VectorField<S>, y0: S, lambda0: number, step: number) {
    super(field, y0, lambda0, step);
    this.vf = field;
    this.k1 = this.vs.create();
    this.k2 = this.vs.create();
    this.k3 = this.vs.create();
    this.k4 = this.vs.create();
    this.scratch = this.vs.create();
  }

  protected stepOnce(dt: number): void {
    const { vs, vf } = this;
    const s = this.state;
    const half = dt / 2;

    vf.evaluateInto(this.k1, s);
    vs.copy(this.scratch, s);
    vs.addScaled(this.scratch, half, this.k1);
    vf.evaluateInto(this.k2, this.scratch);
    vs.copy(this.scratch, s);
    vs.addScaled(this.scratch, half, this.k2);
    vf.evaluateInto(this.k3, this.scratch);
    vs.copy(this.scratch, s);
    vs.addScaled(this.scratch, dt, this.k3);
    vf.evaluateInto(this.k4, this.scratch);

    vs.addScaled(s, dt / 6, this.k1);
    vs.addScaled(s, dt / 3, this.k2);
    vs.addScaled(s, dt / 3, this.k3);
    vs.addScaled(s, dt / 6, this.k4);
  }
}
