import type { SpaceView } from "../../spaces/index.ts";
import type { VectorField } from "../../maps/index.ts";
import { VectorFieldStepper } from "./vector-field-stepper.ts";

export interface ImplicitMidpointOptions {
  // Fixed-point convergence tolerance (max component change between
  // iterations). Default 1e-12.
  tol?: number;
  // Maximum fixed-point iterations per step before giving up. Default 100.
  maxIterations?: number;
}

// The implicit midpoint rule:
//
//   y_{n+1} = y_n + h · v( (y_n + y_{n+1}) / 2 ).
//
// A second-order Gauss method: symplectic on a Hamiltonian vector field, and
// as a Gauss collocation method it conserves *quadratic* invariants exactly.
// That is the sharp side of the RK4 comparison (plan §7): on the geodesic
// flow it holds the null condition H bounded and conserves angular-momentum-
// type charges to floating point, where RK4 drifts.
//
// The step is implicit; we solve for y_{n+1} by fixed-point (Picard)
// iteration, which contracts at the step sizes these flows use. `tol` and
// `maxIterations` are explicit parameters of the scheme, not hidden constants.
// (A Newton inner solve — needing the flow's Jacobian — is the upgrade path
// for stiff regimes; see plan §11.) Working buffers are allocated once.
export class ImplicitMidpoint<V extends SpaceView> extends VectorFieldStepper<V> {
  private readonly tol: number;
  private readonly maxIterations: number;
  private readonly next: V; // current guess for y_{n+1}
  private readonly mid: V; // the midpoint (y_n + next) / 2
  private readonly k: V; // v(mid)

  constructor(vf: VectorField<V>, options: ImplicitMidpointOptions = {}) {
    super(vf);
    this.tol = options.tol ?? 1e-12;
    this.maxIterations = options.maxIterations ?? 100;
    this.next = this.vs.create();
    this.mid = this.vs.create();
    this.k = this.vs.create();
  }

  step(state: V, dt: number): V {
    const { vs, vf } = this;
    const n = state.dimension;
    const yBuf = state.buffer;
    const yOff = state.offset;
    const nextBuf = this.next.buffer; // created buffers: offset 0
    const kBuf = this.k.buffer;

    // Initial guess y_{n+1} = y_n (explicit-Euler seed).
    vs.copy(this.next, state);

    for (let iter = 0; iter < this.maxIterations; iter += 1) {
      // mid = (y_n + next) / 2
      vs.copy(this.mid, state);
      vs.addScaled(this.mid, 1, this.next);
      vs.scale(this.mid, 0.5);

      vf.evaluateInto(this.k, this.mid);

      // next ← y_n + h·k, tracking the largest component change to test
      // convergence in the same sweep.
      let change = 0;
      for (let i = 0; i < n; i += 1) {
        const updated = yBuf[yOff + i]! + dt * kBuf[i]!;
        const delta = Math.abs(updated - nextBuf[i]!);
        if (delta > change) change = delta;
        nextBuf[i] = updated;
      }
      if (change <= this.tol) break;
    }

    vs.copy(state, this.next);
    return state;
  }
}
