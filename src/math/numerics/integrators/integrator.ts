import type { Space, SpaceView } from "../../spaces/index.ts";
import { vectorSpaceOf, type VectorSpace } from "../../linalg/index.ts";

// The runtime protocol every integrator satisfies, whatever scheme produced
// it. Animation, sampling, and trajectory analysis accept `Integrator<S>` and
// never care whether it is RK4, implicit midpoint, or a future scheme. The
// constructors are where schemes differ honestly; this interface is where they
// agree.
export interface Integrator<S> {
  // Advance `state` by one step, in place; returns the same `state`.
  step(state: S, dt: number): S;
  // Advance `state` by `n` steps, in place (like `step`); returns the same
  // `state`. Copy first if you need to keep the initial conditions.
  flow(state: S, dt: number, n: number): S;
  // Run `n` steps from `x0` *non-destructively*, returning every snapshot
  // (initial + one per step, so `n + 1` independent states). `x0` is left
  // untouched. This is what feeds a rendered trajectory.
  integrate(x0: S, dt: number, n: number): S[];
}

// Shared machinery: derive `flow` and `integrate` from a subclass `step`,
// using the state space's R-linear structure to allocate and copy snapshots.
// Concrete families (vector-field steppers, and future Hamiltonian/Lagrangian
// families) extend this and implement `step`.
export abstract class IntegratorBase<S extends SpaceView>
  implements Integrator<S>
{
  protected readonly vs: VectorSpace<S>;

  constructor(stateSpace: Space<S>) {
    this.vs = vectorSpaceOf(stateSpace);
  }

  abstract step(state: S, dt: number): S;

  flow(state: S, dt: number, n: number): S {
    for (let i = 0; i < n; i += 1) this.step(state, dt);
    return state;
  }

  integrate(x0: S, dt: number, n: number): S[] {
    const trajectory: S[] = [];

    const first = this.vs.create();
    this.vs.copy(first, x0);
    trajectory.push(first);

    const state = this.vs.create();
    this.vs.copy(state, x0);
    for (let i = 0; i < n; i += 1) {
      this.step(state, dt);
      const snapshot = this.vs.create();
      this.vs.copy(snapshot, state);
      trajectory.push(snapshot);
    }
    return trajectory;
  }
}
