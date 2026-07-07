import type { SpaceView } from "../../spaces/index.ts";
import type { VectorField } from "../../maps/index.ts";
import { IntegratorBase } from "./integrator.ts";

// Base for integrators driven by an autonomous vector field ẋ = v(x): RK4,
// implicit midpoint, and future explicit/implicit schemes. It fixes the state
// space to the field's space and holds the field; subclasses implement `step`
// against `this.vf` (calling `evaluateInto` for the zero-allocation path) and
// `this.vs` (the R-linear state arithmetic).
export abstract class VectorFieldStepper<V extends SpaceView>
  extends IntegratorBase<V>
{
  protected readonly vf: VectorField<V>;

  constructor(vf: VectorField<V>) {
    super(vf.space);
    this.vf = vf;
  }
}
