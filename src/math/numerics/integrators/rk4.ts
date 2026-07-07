import type { SpaceView } from "../../spaces/index.ts";
import type { VectorField } from "../../maps/index.ts";
import { VectorFieldStepper } from "./vector-field-stepper.ts";

// Classical 4-stage Runge–Kutta.
//
//   k1 = v(y)
//   k2 = v(y + h/2·k1)
//   k3 = v(y + h/2·k2)
//   k4 = v(y + h·k3)
//   y ← y + h/6·(k1 + 2k2 + 2k3 + k4)
//
// Fourth-order, explicit, non-symplectic — the workhorse for smooth,
// non-stiff flows. On a Hamiltonian system it is accurate per step but its
// invariants (energy, quadratic charges) drift secularly over long
// integrations; that is the contrast implicit midpoint exists to show
// (plan §7). Stage buffers are allocated once and reused: `step` allocates
// nothing.
export class RK4<V extends SpaceView> extends VectorFieldStepper<V> {
  private readonly k1: V;
  private readonly k2: V;
  private readonly k3: V;
  private readonly k4: V;
  private readonly scratch: V;

  constructor(vf: VectorField<V>) {
    super(vf);
    this.k1 = this.vs.create();
    this.k2 = this.vs.create();
    this.k3 = this.vs.create();
    this.k4 = this.vs.create();
    this.scratch = this.vs.create();
  }

  step(state: V, dt: number): V {
    const { vs, vf } = this;
    const half = dt / 2;

    vf.evaluateInto(this.k1, state);

    vs.copy(this.scratch, state);
    vs.addScaled(this.scratch, half, this.k1);
    vf.evaluateInto(this.k2, this.scratch);

    vs.copy(this.scratch, state);
    vs.addScaled(this.scratch, half, this.k2);
    vf.evaluateInto(this.k3, this.scratch);

    vs.copy(this.scratch, state);
    vs.addScaled(this.scratch, dt, this.k3);
    vf.evaluateInto(this.k4, this.scratch);

    vs.addScaled(state, dt / 6, this.k1);
    vs.addScaled(state, dt / 3, this.k2);
    vs.addScaled(state, dt / 3, this.k3);
    vs.addScaled(state, dt / 6, this.k4);
    return state;
  }
}
