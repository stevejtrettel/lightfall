import { Matrix } from "../linalg/index.ts";
import type { SpaceView } from "../spaces/index.ts";

// A (pseudo-Riemannian) metric, stated on its *inverse* (contravariant)
// components g^{μν}(x). This is the primary interface (plan §3.4): the
// Hamiltonian geodesic flow consumes g^{μν} and its coordinate derivatives
// directly, so no matrix inversion ever enters the hot loop. Concrete
// spacetimes implement the analytic forms they have; the covariant g_{μν} and
// its uses (index lowering, covariantly-specified metrics) are a cold path
// added later.
//
// `timeIndex` records which coordinate is timelike, so the null-cone sampler
// can orient future-directed directions.
export interface Metric {
  readonly dimension: number;
  readonly timeIndex: number;
  // g^{μν}(x) → out (symmetric, n×n).
  gInverseInto(out: Matrix, x: SpaceView): void;
  // ∂_k g^{μν}(x) → out, for coordinate index k.
  gInverseDerivativeInto(out: Matrix, x: SpaceView, k: number): void;
}

export interface MetricSpec {
  dimension: number;
  // Defaults to 0 (the conventional (−,+,+,…) leading time slot).
  timeIndex?: number;
  gInverseInto: (out: Matrix, x: SpaceView) => void;
  // Analytic ∂_k g^{μν}. Omit to get a central-finite-difference fallback
  // derived from `gInverseInto`.
  gInverseDerivativeInto?: (out: Matrix, x: SpaceView, k: number) => void;
  // Step for the finite-difference fallback. Default 1e-6.
  fdStep?: number;
}

// Assemble a Metric from a spec, filling in the derivative by central finite
// difference when no analytic form is given.
export function metric(spec: MetricSpec): Metric {
  const { dimension, gInverseInto } = spec;
  const timeIndex = spec.timeIndex ?? 0;
  const gInverseDerivativeInto =
    spec.gInverseDerivativeInto ??
    finiteDifferenceDerivative(dimension, gInverseInto, spec.fdStep ?? 1e-6);
  return { dimension, timeIndex, gInverseInto, gInverseDerivativeInto };
}

// Central difference: ∂_k g^{μν}(x) ≈ [g^{μν}(x + h e_k) − g^{μν}(x − h e_k)] / 2h.
// Perturbs coordinate k of the caller's point in place and restores it — no
// per-call allocation. Safe because evaluation is synchronous and the point is
// left exactly as found.
function finiteDifferenceDerivative(
  n: number,
  valueInto: (out: Matrix, x: SpaceView) => void,
  h: number,
): (out: Matrix, x: SpaceView, k: number) => void {
  const plus = Matrix.square(n);
  const minus = Matrix.square(n);
  const inv2h = 1 / (2 * h);
  return (out, x, k) => {
    const xk = x.buffer[x.offset + k]!;
    x.buffer[x.offset + k] = xk + h;
    valueInto(plus, x);
    x.buffer[x.offset + k] = xk - h;
    valueInto(minus, x);
    x.buffer[x.offset + k] = xk; // restore
    for (let i = 0; i < n * n; i += 1) {
      out.data[i] = (plus.data[i]! - minus.data[i]!) * inv2h;
    }
  };
}
