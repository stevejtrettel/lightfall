import type { Space, SpaceView } from "../spaces/index.ts";
import { copyInto } from "../spaces/index.ts";

// A vector field on a space: a rule x ↦ v(x) assigning to each point a vector
// in the same space — i.e. an autonomous ODE right-hand side ẋ = v(x). The
// Hamiltonian geodesic flow (plan §3.2) is one of these on the phase space
// T*M; the harmonic oscillator is one on R².
//
// Two construction paths, one interface:
//
//   VectorField.pure(space, (x) => v)            ergonomic; a fresh v per call
//   VectorField.inPlace(space, (out, x) => void) allocation-aware; writes out
//
// Both expose evaluate(x): V and evaluateInto(out, x): void; whichever form
// wasn't supplied is derived from the other. Integrators call evaluateInto in
// their hot loops, so an `inPlace` field integrates with zero allocation while
// a `pure` field allocates one vector per evaluation. The construction form
// sets the performance ceiling; the interface is identical either way.
//
// Autonomous by design: the rule depends on state alone. For a time-dependent
// law ẋ = v(x, t), carry the clock as a state component with derivative 1.
export class VectorField<V extends SpaceView> {
  readonly space: Space<V>;
  readonly evaluate: (x: V) => V;
  readonly evaluateInto: (out: V, x: V) => void;

  private constructor(
    space: Space<V>,
    evaluate: (x: V) => V,
    evaluateInto: (out: V, x: V) => void,
  ) {
    this.space = space;
    this.evaluate = evaluate;
    this.evaluateInto = evaluateInto;
  }

  static pure<V extends SpaceView>(
    space: Space<V>,
    fn: (x: V) => V,
  ): VectorField<V> {
    const evaluateInto = (out: V, x: V): void => copyInto(out, fn(x));
    return new VectorField(space, fn, evaluateInto);
  }

  static inPlace<V extends SpaceView>(
    space: Space<V>,
    fnInto: (out: V, x: V) => void,
  ): VectorField<V> {
    const evaluate = (x: V): V => {
      const out = space.create();
      fnInto(out, x);
      return out;
    };
    return new VectorField(space, evaluate, fnInto);
  }
}
