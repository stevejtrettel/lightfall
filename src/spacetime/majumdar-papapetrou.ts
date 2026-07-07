import { LorentzianManifold, metric } from "../math/lorentzian/index.ts";
import { spacetimeChart, TIME_INDEX, type Event } from "./chart.ts";

// A black hole in the Majumdar–Papapetrou family: an extremal (charge = mass)
// hole sitting at a point of the spatial plane. `mass` is the m_i that enters
// the potential; equilibrium among many holes is automatic (the electric
// repulsion exactly cancels the gravitational attraction — that is what makes
// the static multi-hole solution exist).
export interface BlackHole {
  mass: number;
  x: number;
  y: number;
}

// The harmonic potential U(x, y) = 1 + Σ mᵢ / |r − rᵢ|. The entire physics of
// the family is downstream of this one function: the metric, the lensing, the
// horizons (the throats at r → rᵢ where U → ∞).
export function potential(
  holes: readonly BlackHole[],
  x: number,
  y: number,
): number {
  let u = 1;
  for (const h of holes) {
    u += h.mass / Math.hypot(x - h.x, y - h.y);
  }
  return u;
}

// The MP spacetime as a metric on the 2+1 chart:
//
//   g^{μν} = diag(−U², U⁻², U⁻²)     (the physical metric, plan §3.4)
//
// with analytic derivatives from ∇U — static, so ∂_t g ≡ 0. Integrated by the
// general Hamiltonian engine like any other metric; nothing here knows about
// light cones or rendering.
export function majumdarPapapetrou(
  holes: readonly BlackHole[],
): LorentzianManifold<Event> {
  const chart = spacetimeChart(`Majumdar–Papapetrou(${holes.length})`);

  const g = metric({
    dimension: 3,
    timeIndex: TIME_INDEX,
    gInverseInto: (out, pt) => {
      const u = potential(holes, pt.buffer[pt.offset + 1]!, pt.buffer[pt.offset + 2]!);
      const u2 = u * u;
      out.zero();
      out.set(0, 0, -u2);
      out.set(1, 1, 1 / u2);
      out.set(2, 2, 1 / u2);
    },
    gInverseDerivativeInto: (out, pt, k) => {
      out.zero();
      if (k === TIME_INDEX) return; // static

      const x = pt.buffer[pt.offset + 1]!;
      const y = pt.buffer[pt.offset + 2]!;
      // U and ∇U in a single pass over the holes (allocation-free).
      let u = 1;
      let ux = 0;
      let uy = 0;
      for (const h of holes) {
        const dx = x - h.x;
        const dy = y - h.y;
        const r = Math.hypot(dx, dy);
        const r3 = r * r * r;
        u += h.mass / r;
        ux -= (h.mass * dx) / r3;
        uy -= (h.mass * dy) / r3;
      }
      const uk = k === 1 ? ux : uy;

      // ∂_k(−U²) = −2U Uₖ ;  ∂_k(U⁻²) = −2 U⁻³ Uₖ
      out.set(0, 0, -2 * u * uk);
      const dSpatial = (-2 * uk) / (u * u * u);
      out.set(1, 1, dSpatial);
      out.set(2, 2, dSpatial);
    },
  });

  return new LorentzianManifold(chart, g);
}
