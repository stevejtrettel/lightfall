import type { Space, SpaceView } from "../spaces/index.ts";

// A scalar field on a space: a rule x ↦ f(x) ∈ ℝ. The Hamiltonian H on the
// phase space is one of these (its zero set is the null cone — the diagnostic
// we watch along a trajectory); the Majumdar–Papapetrou potential U on the
// spatial plane will be another.
//
// The output is a plain number, so there is no `evaluateInto` counterpart —
// nothing to write into. If a hot loop needs a scalar without allocation, a
// scalar field already delivers it: `evaluate` returns a primitive.
export class ScalarField<V extends SpaceView> {
  readonly space: Space<V>;
  readonly evaluate: (x: V) => number;

  private constructor(space: Space<V>, evaluate: (x: V) => number) {
    this.space = space;
    this.evaluate = evaluate;
  }

  static of<V extends SpaceView>(
    space: Space<V>,
    fn: (x: V) => number,
  ): ScalarField<V> {
    return new ScalarField(space, fn);
  }
}
