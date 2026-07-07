import type { SpaceView } from "../../spaces/index.ts";
import { vectorSpaceOf, type VectorSpace } from "../../linalg/index.ts";
import type { VectorField } from "../../maps/index.ts";

// A Solver is one trajectory in flight. It owns the mutable per-trajectory
// state — the current affine parameter λ, the state there, and (for adaptive
// schemes) the working step size and stage memory. `advanceTo(λ)` integrates
// up to a target λ, however many internal steps that takes; for adaptive
// schemes it uses dense output to land exactly on λ without forcing a small
// step. `alive` goes false once the trajectory can't progress (the step floors
// out at a singularity, or the state goes non-finite). One Solver per ray.
export interface Solver<S> {
  readonly lambda: number;
  readonly state: S;
  readonly alive: boolean;
  advanceTo(lambda: number): void;
}

// A Method is a reusable, immutable configuration (scheme + tolerances/step).
// Binding it to an initial value yields a Solver. The constructor is where
// paradigms differ — a vector-field scheme takes a VectorField, a future
// Hamiltonian scheme takes richer structure — but every Method produces the
// same Solver protocol, so a consumer (the light cone) is agnostic to which
// scheme traces it.
export interface Method<S> {
  solver(y0: S, lambda0?: number): Solver<S>;
}

// True iff every component of `v` is finite.
export function allFinite(v: SpaceView): boolean {
  const b = v.buffer;
  const o = v.offset;
  for (let i = 0; i < v.dimension; i += 1) {
    if (!Number.isFinite(b[o + i]!)) return false;
  }
  return true;
}

// Base for fixed-step schemes (RK4, implicit midpoint). `advanceTo` subdivides
// [λ, target] into uniform substeps of size ≈ `step` and calls `stepOnce`, so
// the sub-steps stay uniform within an interval (which keeps a symplectic
// `stepOnce` symplectic). A non-finite state ends the trajectory.
export abstract class FixedStepSolver<S extends SpaceView> implements Solver<S> {
  protected readonly vs: VectorSpace<S>;
  readonly state: S;
  lambda: number;
  alive = true;
  protected readonly step: number;

  constructor(field: VectorField<S>, y0: S, lambda0: number, step: number) {
    if (!(step > 0)) throw new RangeError(`fixed step must be > 0, got ${step}`);
    this.vs = vectorSpaceOf(field.space);
    this.state = this.vs.create();
    this.vs.copy(this.state, y0);
    this.lambda = lambda0;
    this.step = step;
  }

  // Advance `this.state` by `dt`, in place.
  protected abstract stepOnce(dt: number): void;

  advanceTo(target: number): void {
    if (!this.alive || target <= this.lambda) return;
    const span = target - this.lambda;
    const n = Math.max(1, Math.ceil(span / this.step));
    const dt = span / n;
    for (let i = 0; i < n; i += 1) {
      this.stepOnce(dt);
      if (!allFinite(this.state)) {
        this.alive = false;
        return;
      }
    }
    this.lambda = target;
  }
}
