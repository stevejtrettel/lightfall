import type { SpaceView } from "../../spaces/index.ts";
import { vectorSpaceOf, type VectorSpace } from "../../linalg/index.ts";
import type { VectorField } from "../../maps/index.ts";
import type { Method, Solver } from "./solver.ts";

// Dormand–Prince 5(4), FSAL — the standard adaptive explicit RK for smooth
// non-stiff flows (this is `ode45` / SciPy `RK45`). Butcher tableau below.
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
// 5th-order solution weights (b7 = 0; stage 7 is FSAL = f(y_{n+1})).
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
// Error weights (b − b̂), used with stages 1,3,4,5,6,7.
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;
// Dense-output (4th-order continuous extension) coefficients.
const D1 = -12715105075 / 11282082432;
const D3 = 87487479700 / 32700410799;
const D4 = -10690763975 / 1880347072;
const D5 = 701980252875 / 199316789632;
const D6 = -1453857185 / 822651844;
const D7 = 69997945 / 29380423;

const ORDER_EXP = 0.2; // 1/(embedded order + 1), embedded order 4
const BETA = 0.04; // PI-controller memory

export interface DormandPrinceOptions {
  rtol?: number; // relative tolerance, default 1e-7
  atol?: number; // absolute tolerance, default 1e-9
  initialStep?: number; // default: estimated automatically
  minStep?: number; // step floor; hitting it ends the trajectory (singularity)
  maxStep?: number;
  safety?: number; // step-control safety factor, default 0.9
  minScale?: number; // max shrink per step, default 0.2
  maxScale?: number; // max growth per step, default 10
}

export class DormandPrince<S extends SpaceView> implements Method<S> {
  private readonly field: VectorField<S>;
  private readonly options: DormandPrinceOptions;

  constructor(field: VectorField<S>, options: DormandPrinceOptions = {}) {
    this.field = field;
    this.options = options;
  }

  solver(y0: S, lambda0 = 0): Solver<S> {
    return new DormandPrinceSolver(this.field, this.options, y0, lambda0);
  }
}

class DormandPrinceSolver<S extends SpaceView> implements Solver<S> {
  private readonly vs: VectorSpace<S>;
  private readonly field: VectorField<S>;
  private readonly rtol: number;
  private readonly atol: number;
  private readonly minStep: number;
  private readonly maxStep: number;
  private readonly safety: number;
  private readonly minScale: number;
  private readonly maxScale: number;

  lambda: number; // output parameter (last advanceTo target)
  alive = true;
  readonly state: S; // output state at `lambda` (via dense output)

  private intLambda: number; // internal integration point (accepted-step boundary)
  private readonly y: S; // internal state at intLambda
  private h: number;
  private errOld = 1e-4;
  private k1valid = false; // k1 = f(y) currently valid (FSAL / reuse across rejects)

  private readonly k1: S; private readonly k2: S; private readonly k3: S;
  private readonly k4: S; private readonly k5: S; private readonly k6: S; private readonly k7: S;
  private readonly ytmp: S; private readonly yNew: S;
  private readonly r1: S; private readonly r2: S; private readonly r3: S; private readonly r4: S; private readonly r5: S;
  private denseStart = 0;
  private denseH = 1;

  constructor(field: VectorField<S>, options: DormandPrinceOptions, y0: S, lambda0: number) {
    this.field = field;
    this.vs = vectorSpaceOf(field.space);
    this.rtol = options.rtol ?? 1e-7;
    this.atol = options.atol ?? 1e-9;
    this.minStep = options.minStep ?? 1e-10;
    this.maxStep = options.maxStep ?? Infinity;
    this.safety = options.safety ?? 0.9;
    this.minScale = options.minScale ?? 0.2;
    this.maxScale = options.maxScale ?? 10;

    this.state = this.vs.create();
    this.vs.copy(this.state, y0);
    this.y = this.vs.create();
    this.vs.copy(this.y, y0);
    this.lambda = lambda0;
    this.intLambda = lambda0;

    this.k1 = this.vs.create(); this.k2 = this.vs.create(); this.k3 = this.vs.create();
    this.k4 = this.vs.create(); this.k5 = this.vs.create(); this.k6 = this.vs.create(); this.k7 = this.vs.create();
    this.ytmp = this.vs.create(); this.yNew = this.vs.create();
    this.r1 = this.vs.create(); this.r2 = this.vs.create(); this.r3 = this.vs.create();
    this.r4 = this.vs.create(); this.r5 = this.vs.create();

    this.h = options.initialStep ?? this.guessInitialStep();
  }

  advanceTo(target: number): void {
    if (!this.alive || target <= this.lambda) return;
    while (this.intLambda < target && this.alive) this.internalStep();
    if (!this.alive) {
      // Terminated mid-interval (step floored at a singularity): report the
      // last valid integrated point so the caller sees how far the ray got.
      this.vs.copy(this.state, this.y);
      this.lambda = this.intLambda;
      return;
    }
    this.interpolateInto(this.state, target);
    this.lambda = target;
  }

  private internalStep(): void {
    const { vs, field } = this;
    const y = this.y;
    if (!this.k1valid) {
      field.evaluateInto(this.k1, y);
      this.k1valid = true;
    }

    for (;;) {
      const h = Math.min(this.h, this.maxStep);
      if (h < this.minStep) {
        this.alive = false;
        return;
      }

      vs.copy(this.ytmp, y);
      vs.addScaled(this.ytmp, h * A21, this.k1);
      field.evaluateInto(this.k2, this.ytmp);

      vs.copy(this.ytmp, y);
      vs.addScaled(this.ytmp, h * A31, this.k1);
      vs.addScaled(this.ytmp, h * A32, this.k2);
      field.evaluateInto(this.k3, this.ytmp);

      vs.copy(this.ytmp, y);
      vs.addScaled(this.ytmp, h * A41, this.k1);
      vs.addScaled(this.ytmp, h * A42, this.k2);
      vs.addScaled(this.ytmp, h * A43, this.k3);
      field.evaluateInto(this.k4, this.ytmp);

      vs.copy(this.ytmp, y);
      vs.addScaled(this.ytmp, h * A51, this.k1);
      vs.addScaled(this.ytmp, h * A52, this.k2);
      vs.addScaled(this.ytmp, h * A53, this.k3);
      vs.addScaled(this.ytmp, h * A54, this.k4);
      field.evaluateInto(this.k5, this.ytmp);

      vs.copy(this.ytmp, y);
      vs.addScaled(this.ytmp, h * A61, this.k1);
      vs.addScaled(this.ytmp, h * A62, this.k2);
      vs.addScaled(this.ytmp, h * A63, this.k3);
      vs.addScaled(this.ytmp, h * A64, this.k4);
      vs.addScaled(this.ytmp, h * A65, this.k5);
      field.evaluateInto(this.k6, this.ytmp);

      vs.copy(this.yNew, y);
      vs.addScaled(this.yNew, h * B1, this.k1);
      vs.addScaled(this.yNew, h * B3, this.k3);
      vs.addScaled(this.yNew, h * B4, this.k4);
      vs.addScaled(this.yNew, h * B5, this.k5);
      vs.addScaled(this.yNew, h * B6, this.k6);
      field.evaluateInto(this.k7, this.yNew);

      const err = this.errorNorm(h, y);
      if (Number.isFinite(err) && err <= 1) {
        this.storeDense(h, y);
        this.denseStart = this.intLambda;
        this.denseH = h;
        this.intLambda += h;
        vs.copy(y, this.yNew);
        vs.copy(this.k1, this.k7); // FSAL: k1 of next step = f(y_{n+1})
        this.k1valid = true;
        this.h = h * this.controlScale(err, true);
        this.errOld = Math.max(err, 1e-4);
        return;
      }

      // Reject: shrink and retry (k1 = f(y) still valid, y unchanged).
      const e = Number.isFinite(err) ? err : 1e10;
      this.h = h * this.controlScale(e, false);
    }
  }

  private errorNorm(h: number, y: S): number {
    const n = y.dimension;
    const yb = y.buffer, yo = y.offset;
    const nb = this.yNew.buffer, no = this.yNew.offset;
    const g = (v: S, i: number): number => v.buffer[v.offset + i]!;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const erri =
        h *
        (E1 * g(this.k1, i) + E3 * g(this.k3, i) + E4 * g(this.k4, i) +
          E5 * g(this.k5, i) + E6 * g(this.k6, i) + E7 * g(this.k7, i));
      const sc = this.atol + this.rtol * Math.max(Math.abs(yb[yo + i]!), Math.abs(nb[no + i]!));
      const ratio = erri / sc;
      sum += ratio * ratio;
    }
    return Math.sqrt(sum / n);
  }

  private controlScale(err: number, accepted: boolean): number {
    const e = Math.max(err, 1e-10);
    const scale = accepted
      ? this.safety * Math.pow(e, -(ORDER_EXP - 0.75 * BETA)) * Math.pow(this.errOld, BETA)
      : this.safety * Math.pow(e, -ORDER_EXP);
    return Math.max(this.minScale, Math.min(accepted ? this.maxScale : 1, scale));
  }

  private storeDense(h: number, yOld: S): void {
    const { vs } = this;
    vs.copy(this.r1, yOld);
    vs.copy(this.r2, this.yNew);
    vs.addScaled(this.r2, -1, yOld);
    vs.copy(this.r3, this.k1);
    vs.scale(this.r3, h);
    vs.addScaled(this.r3, -1, this.r2);
    vs.copy(this.r4, this.r2);
    vs.addScaled(this.r4, -h, this.k7);
    vs.addScaled(this.r4, -1, this.r3);
    vs.zero(this.r5);
    vs.addScaled(this.r5, h * D1, this.k1);
    vs.addScaled(this.r5, h * D3, this.k3);
    vs.addScaled(this.r5, h * D4, this.k4);
    vs.addScaled(this.r5, h * D5, this.k5);
    vs.addScaled(this.r5, h * D6, this.k6);
    vs.addScaled(this.r5, h * D7, this.k7);
  }

  private interpolateInto(out: S, lambda: number): void {
    let theta = (lambda - this.denseStart) / this.denseH;
    if (theta < 0) theta = 0;
    if (theta > 1) theta = 1;
    const s = 1 - theta;
    const n = out.dimension;
    const ob = out.buffer, oo = out.offset;
    const g = (v: S, i: number): number => v.buffer[v.offset + i]!;
    for (let i = 0; i < n; i += 1) {
      ob[oo + i] =
        g(this.r1, i) +
        theta * (g(this.r2, i) + s * (g(this.r3, i) + theta * (g(this.r4, i) + s * g(this.r5, i))));
    }
  }

  // Hairer's initial-step estimate; sets k1 = f(y0) for a warm FSAL start.
  private guessInitialStep(): number {
    const { field } = this;
    const y = this.y;
    const n = y.dimension;
    field.evaluateInto(this.k1, y);
    this.k1valid = true;

    const g = (v: S, i: number): number => v.buffer[v.offset + i]!;
    let d0 = 0, d1 = 0;
    for (let i = 0; i < n; i += 1) {
      const sc = this.atol + this.rtol * Math.abs(g(y, i));
      d0 += (g(y, i) / sc) ** 2;
      d1 += (g(this.k1, i) / sc) ** 2;
    }
    d0 = Math.sqrt(d0 / n);
    d1 = Math.sqrt(d1 / n);
    const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * (d0 / d1);

    this.vs.copy(this.ytmp, y);
    this.vs.addScaled(this.ytmp, h0, this.k1);
    field.evaluateInto(this.k2, this.ytmp);
    let d2 = 0;
    for (let i = 0; i < n; i += 1) {
      const sc = this.atol + this.rtol * Math.abs(g(y, i));
      d2 += ((g(this.k2, i) - g(this.k1, i)) / sc / h0) ** 2;
    }
    d2 = Math.sqrt(d2 / n);

    const dmax = Math.max(d1, d2);
    const h1 = dmax <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / dmax) ** ORDER_EXP;
    return Math.min(100 * h0, h1, this.maxStep);
  }
}
