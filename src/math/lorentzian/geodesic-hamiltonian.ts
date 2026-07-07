import {
  cotangentBundle,
  type ProductView,
  type Space,
  type SpaceView,
} from "../spaces/index.ts";
import { VectorField, ScalarField } from "../maps/index.ts";
import { Matrix } from "../linalg/index.ts";
import type { LorentzianManifold } from "./lorentzian-manifold.ts";

// The canonical phase space T*M of a spacetime: states (pos, mom) with
// pos a chart point x^μ and mom a covector p_μ.
export type PhaseView<V extends SpaceView> = ProductView<{
  pos: Space<V>;
  mom: Space<V>;
}>;

export function phaseSpace<V extends SpaceView>(
  M: LorentzianManifold<V>,
): Space<PhaseView<V>> {
  return cotangentBundle(M.chart);
}

// The geodesic flow as Hamilton's equations for H = ½ g^{μν}(x) p_μ p_ν
// (plan §3.2):
//
//   ẋ^μ = g^{μν}(x) p_ν
//   ṗ_λ = −½ (∂_λ g^{μν}(x)) p_μ p_ν
//
// Returned as an in-place VectorField on T*M, so an integrator flows it with
// zero allocation. Null geodesics are the trajectories that start (and stay)
// on {H = 0}; the flow is agnostic to that — the null condition is imposed by
// the initial momentum (see `nullConeAt`), and `hamiltonian(M)` monitors it.
export function geodesicHamiltonian<V extends SpaceView>(
  M: LorentzianManifold<V>,
): VectorField<PhaseView<V>> {
  const phase = cotangentBundle(M.chart);
  const n = M.dimension;
  const metric = M.metric;
  const gInv = Matrix.square(n);
  const dG = Matrix.square(n);

  return VectorField.inPlace(phase, (out, s) => {
    const pb = s.mom.buffer;
    const po = s.mom.offset;
    const dxb = out.pos.buffer;
    const dxo = out.pos.offset;
    const dpb = out.mom.buffer;
    const dpo = out.mom.offset;

    // ẋ^μ = Σ_ν g^{μν}(x) p_ν
    metric.gInverseInto(gInv, s.pos);
    for (let mu = 0; mu < n; mu += 1) {
      let v = 0;
      for (let nu = 0; nu < n; nu += 1) v += gInv.get(mu, nu) * pb[po + nu]!;
      dxb[dxo + mu] = v;
    }

    // ṗ_λ = −½ Σ_{μν} ∂_λ g^{μν}(x) p_μ p_ν
    for (let lam = 0; lam < n; lam += 1) {
      metric.gInverseDerivativeInto(dG, s.pos, lam);
      let q = 0;
      for (let mu = 0; mu < n; mu += 1) {
        const pMu = pb[po + mu]!;
        for (let nu = 0; nu < n; nu += 1) q += dG.get(mu, nu) * pMu * pb[po + nu]!;
      }
      dpb[dpo + lam] = -0.5 * q;
    }
  });
}

// H(x, p) = ½ g^{μν}(x) p_μ p_ν as a scalar field on T*M. Its value is the
// null defect: 0 on null geodesics, and its drift along an integrated
// trajectory is the coordinate-invariant error meter of plan §3.2.
export function hamiltonian<V extends SpaceView>(
  M: LorentzianManifold<V>,
): ScalarField<PhaseView<V>> {
  const phase = cotangentBundle(M.chart);
  const n = M.dimension;
  const metric = M.metric;
  const gInv = Matrix.square(n);

  return ScalarField.of(phase, (s) => {
    const pb = s.mom.buffer;
    const po = s.mom.offset;
    metric.gInverseInto(gInv, s.pos);
    let value = 0;
    for (let mu = 0; mu < n; mu += 1) {
      const pMu = pb[po + mu]!;
      for (let nu = 0; nu < n; nu += 1) value += gInv.get(mu, nu) * pMu * pb[po + nu]!;
    }
    return 0.5 * value;
  });
}
