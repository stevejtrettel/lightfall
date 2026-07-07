import { productSpace } from "./product.ts";
import type { ProductView } from "./product.ts";
import type { Space, SpaceView } from "./space.ts";

// Flat-chart bundle sugar over productSpace. In a single coordinate chart the
// bundles are just products of the base with itself; when curved-manifold
// bundles ever arrive they will be a different construction living alongside
// these, not a retrofit of them.

// Cotangent bundle T*M — the canonical phase space `(pos, mom)` the
// Hamiltonian geodesic flow evolves (plan §3.2). `pos` is a point of the
// chart; `mom` is a covector p_μ at that point. Both are live sub-views:
//
//   const phase = cotangentBundle(chart);
//   const s = phase.create((s) => { s.pos.set(t, x, y); s.mom.set(pt, px, py); });
export function cotangentBundle<V extends SpaceView>(
  base: Space<V>,
  options: { name?: string } = {},
): Space<ProductView<{ pos: Space<V>; mom: Space<V> }>> {
  return productSpace(
    { pos: base, mom: base },
    { name: options.name ?? `T*${base.name}` },
  );
}

// Tangent bundle TM — `(pos, vel)`. The Hamiltonian flow does not use this
// (we carry momenta), but it is the natural home for velocities recovered via
// ẋ = g⁻¹ p when rendering ray tangents, and for a future Lagrangian path
// (plan §3.3).
export function tangentBundle<V extends SpaceView>(
  base: Space<V>,
  options: { name?: string } = {},
): Space<ProductView<{ pos: Space<V>; vel: Space<V> }>> {
  return productSpace(
    { pos: base, vel: base },
    { name: options.name ?? `T${base.name}` },
  );
}
